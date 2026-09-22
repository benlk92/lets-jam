import { useEffect, useMemo, useState } from 'react';
import type {
  Category,
  CategoryFilter,
  FilterState,
  PlaylistDetail,
  PlaylistSummary,
  QueueEntry,
  RatingScaleEntry,
  Song,
  SortCriterion,
  Space,
  TagValue,
} from './types';
import {
  addCategory,
  addCategoryValue,
  addRatingEntry,
  addSong,
  clearNotApplicable,
  deleteCategoryValue,
  deleteSong,
  getAppKeyRole,
  getCategories,
  getRatingScale,
  getSongs,
  loadCachedSnapshot,
  markCategoryNotApplicable,
  pendingWriteCount,
  rateSong,
  removeRatingEntry,
  renameCategory,
  renameCategoryValue,
  reorderCategories,
  reorderCategoryValues,
  retireCategory,
  setCategoryGuidedPickerEnabled,
  setCategoryScatterPickerEnabled,
  setCurrentSpace,
  setMemorized,
  syncPendingWrites,
  updateRatingEntry,
  updateSongTag,
  updateChordChart,
  updateSongUrl,
  updateSongTitleArtist,
  addSongRecording,
  renameSongRecording,
  removeSongRecording,
  getSongAudioUrl,
  getPlaylists,
  getPlaylistDetail,
  createPlaylistFromQueue,
  setPlaylistSongs,
  renamePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  setPlaylistSongLeader,
  reorderPlaylistSongs,
  getPlaylistLeaders,
  addPlaylistLeader,
  renamePlaylistLeader,
  removePlaylistLeader,
  reorderPlaylistLeaders,
} from './data/store';
import { isNetworkError } from './data/offlineCache';
import { initSupabaseClient } from './data/supabaseClient';
import { filterSongs, GENRE_CATEGORY_ID, shuffledSample, sortSongs } from './lib/filtering';
import { buildGapFillQueue, gapFillAt, gapFillTotal, type GapFillMode, type GapFillQueue } from './lib/gapfill';
import Splash from './screens/Splash';
import PassphraseGate from './screens/PassphraseGate';
import GuidedPicker from './screens/GuidedPicker';
import ScatterPicker from './screens/ScatterPicker';
import PickerChooser from './screens/PickerChooser';
import Results from './screens/Results';
import FiltersPanel from './screens/FiltersPanel';
import SortPanel from './screens/SortPanel';
import Assessment from './screens/Assessment';
import ChordChartViewer from './screens/ChordChartViewer';
import GapFill from './screens/GapFill';
import Settings from './screens/Settings';
import AddSong from './screens/AddSong';
import SongQueue from './screens/SongQueue';
import Playlists from './screens/Playlists';
import PlaylistDetailScreen from './screens/PlaylistDetail';
import Matrix from './screens/Matrix';
import SongTagEditor from './components/SongTagEditor';
import './App.css';

type Screen =
  | 'loading'
  | 'passphrase'
  | 'splash'
  | 'picker'
  | 'scatter'
  | 'pickerChooser'
  | 'results'
  | 'assessment'
  | 'chordChart'
  | 'gapfill'
  | 'settings'
  | 'addsong'
  | 'queue'
  | 'playlists'
  | 'playlistDetail'
  | 'matrix';

// Which category set feeds the shared 'picker' screen — the full Guided
// Picker sequence, or just the single-step Genre Picker shortcut.
type PickerMode = 'full' | 'genre';

// Where the Assessment screen should return to — Results (the default) or
// the Song Queue, when a song was opened from there instead.
type AssessmentOrigin = 'results' | 'queue';

// Also the reset target on a space switch — a fresh space starts from the
// same clean slate a first-ever visit would.
const DEFAULT_SORT_CRITERIA: SortCriterion[] = [
  { key: 'performance_confidence', direction: 'desc' },
  { key: 'artist', direction: 'asc' },
];

const IDLE_MS = 60 * 60 * 1000;
const LAST_ACTIVE_KEY = 'songapp:lastActiveAt';

// RLS enforces this server-side (see the migration) — this is just the
// client-side "don't ask again for a while" convenience the brief calls for.
const PASSPHRASE_KEY = 'songapp:passphrase';
const PASSPHRASE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Role = 'admin' | 'viewer';

function shouldResume(): boolean {
  try {
    const lastActive = localStorage.getItem(LAST_ACTIVE_KEY);
    return !!lastActive && Date.now() - Number(lastActive) < IDLE_MS;
  } catch {
    return false;
  }
}

function markActive() {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — resume-detection just degrades to "always splash"
  }
}

function loadStoredPassphrase(): { value: string; role: Role } | null {
  try {
    const raw = localStorage.getItem(PASSPHRASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value: string; setAt: number; role?: Role };
    if (Date.now() - parsed.setAt > PASSPHRASE_TTL_MS) return null;
    // Older stored sessions (before roles existed) never wrote a role —
    // they were only ever the admin key, since viewer keys didn't exist yet.
    return { value: parsed.value, role: parsed.role ?? 'admin' };
  } catch {
    return null;
  }
}

function storePassphrase(value: string, role: Role) {
  try {
    localStorage.setItem(PASSPHRASE_KEY, JSON.stringify({ value, role, setAt: Date.now() }));
  } catch {
    // localStorage unavailable — the gate just shows again next load
  }
}

// Device-local UI preference, not song data — no need to sync it across
// devices the way the brief requires for the actual library.
const OPEN_UG_ON_TAP_KEY = 'songapp:openUgOnTap';

function loadOpenUgOnTap(): boolean {
  try {
    const raw = localStorage.getItem(OPEN_UG_ON_TAP_KEY);
    return raw == null ? true : raw === 'true';
  } catch {
    return true;
  }
}

// The performance queue — songs (each carrying a leader, if it came from an
// imported playlist), in the order they were added. Purely a device-local
// session aid (not song data, and admin-only), so it lives in localStorage
// rather than the database like openUgOnTap above. v2: entries carry a
// leader alongside the song id, and the queue remembers which playlist (if
// any) it was imported from, so "Save" can offer to update that playlist
// in place instead of only ever creating a new one.
const QUEUE_KEY = 'songapp:queue:v2';

interface StoredQueueState {
  entries: QueueEntry[];
  importedFromPlaylistId: string | null;
}

function loadQueueState(): StoredQueueState {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return { entries: [], importedFromPlaylistId: null };
    const parsed = JSON.parse(raw);
    const entries: QueueEntry[] = Array.isArray(parsed?.entries)
      ? parsed.entries
          .filter((e: unknown): e is { songId: unknown; leader: unknown } => typeof e === 'object' && e !== null)
          .filter((e: { songId: unknown }) => typeof e.songId === 'string')
          .map((e: { songId: unknown; leader: unknown }) => ({
            songId: e.songId as string,
            leader: typeof e.leader === 'string' ? e.leader : null,
          }))
      : [];
    const importedFromPlaylistId = typeof parsed?.importedFromPlaylistId === 'string' ? parsed.importedFromPlaylistId : null;
    return { entries, importedFromPlaylistId };
  } catch {
    return { entries: [], importedFromPlaylistId: null };
  }
}

function saveQueueState(state: StoredQueueState) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable — queue just won't survive a reload
  }
}

// Which of the two independent song libraries is active — device-local,
// like the queue above, not something the passphrase or the data itself
// determines.
const SPACE_KEY = 'songapp:space';

function loadSpace(): Space {
  try {
    return localStorage.getItem(SPACE_KEY) === 'circle_songs' ? 'circle_songs' : 'pop_songs';
  } catch {
    return 'pop_songs';
  }
}

function saveSpace(space: Space) {
  try {
    localStorage.setItem(SPACE_KEY, space);
  } catch {
    // localStorage unavailable — reverts to Pop Songs next load
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [categories, setCategories] = useState<Category[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [ratingScale, setRatingScale] = useState<RatingScaleEntry[]>([]);

  const [filters, setFilters] = useState<FilterState>({});
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const [showStaleness, setShowStaleness] = useState(false);
  const [sortCriteria, setSortCriteria] = useState<SortCriterion[]>(DEFAULT_SORT_CRITERIA);
  const [pickerStep, setPickerStep] = useState(0);
  const [pickerMode, setPickerMode] = useState<PickerMode>('full');
  // Song ids from the most recent "Random 10" pick — narrows the results
  // list down to just these before the normal category filters apply, so
  // Filters/Sort still work predictably on top of the random set.
  const [randomTenIds, setRandomTenIds] = useState<string[] | null>(null);

  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [activeSongOrigin, setActiveSongOrigin] = useState<AssessmentOrigin>('results');
  // Where "← Back" from the chord chart viewer returns to — 'assessment' when
  // opened from there, 'results' when opened directly from a song row.
  const [chordChartOrigin, setChordChartOrigin] = useState<'assessment' | 'results'>('assessment');
  const [tagEditorSongId, setTagEditorSongId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [openUgOnTap, setOpenUgOnTapState] = useState(loadOpenUgOnTap);
  const [initialQueueState] = useState(loadQueueState);
  const [queue, setQueue] = useState<QueueEntry[]>(initialQueueState.entries);
  const [importedFromPlaylistId, setImportedFromPlaylistId] = useState<string | null>(
    initialQueueState.importedFromPlaylistId,
  );

  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistDetail | null>(null);

  const [gapFillQueue, setGapFillQueue] = useState<GapFillQueue | null>(null);
  const [gapFillIndex, setGapFillIndex] = useState(0);
  const [gapFillMode, setGapFillMode] = useState<GapFillMode>('gaps');

  // isOffline: last load/reconnect attempt used the cached snapshot instead
  // of a live fetch. offlineUnavailable: never been online, so there's no
  // cache to fall back to at all — a distinct dead-end from plain loading.
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const [pendingCount, setPendingCount] = useState(pendingWriteCount);

  // Captured once at first render, before any effect can mark the session
  // active — otherwise StrictMode's double-invoked mount effect would see
  // the timestamp its own first run just wrote and always "resume".
  const [initialResume] = useState(shouldResume);
  const [initialPassphrase] = useState(loadStoredPassphrase);
  const [role, setRole] = useState<Role>(initialPassphrase?.role ?? 'admin');
  const canEdit = role === 'admin';

  const [initialSpace] = useState(loadSpace);
  const [space, setSpaceState] = useState<Space>(initialSpace);

  async function loadAppData() {
    try {
      const [s, c, r, p, l] = await Promise.all([
        getSongs(),
        getCategories(),
        getRatingScale(),
        getPlaylists(),
        getPlaylistLeaders(),
      ]);
      setSongs(s);
      setCategories(c);
      setRatingScale(r);
      setPlaylists(p);
      setLeaders(l);
      setIsOffline(false);
      setOfflineUnavailable(false);
      setScreen(initialResume ? 'results' : 'splash');
      markActive();
      if (pendingWriteCount() > 0) {
        const { remaining } = await syncPendingWrites();
        setPendingCount(remaining);
        setSongs(await getSongs());
      }
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const cached = loadCachedSnapshot();
      if (!cached) {
        setOfflineUnavailable(true);
        return;
      }
      setSongs(cached.songs);
      setCategories(cached.categories);
      setRatingScale(cached.ratingScale);
      setIsOffline(true);
      setScreen(initialResume ? 'results' : 'splash');
      markActive();
    }
  }

  useEffect(() => {
    setCurrentSpace(initialSpace);
    if (initialPassphrase) {
      initSupabaseClient(initialPassphrase.value);
      loadAppData();
    } else {
      setScreen('passphrase');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPassphrase]);

  // A wrong passphrase isn't rejected with an error — RLS just filters every
  // row to nothing — so "did this work" is judged by whether categories (a
  // table that's never legitimately empty) actually came back. This check
  // must stay network-only (no cache fallback) — otherwise typing any
  // string while genuinely offline would appear to succeed against stale
  // data left over from a previous, different passphrase.
  async function handlePassphraseSubmit(passphrase: string): Promise<string | null> {
    initSupabaseClient(passphrase);
    let resolvedRole: Role;
    try {
      const categoriesCheck = await getCategories();
      if (categoriesCheck.length === 0) return "That passphrase didn't work — try again.";
      // Both keys pass the read check above — ask the database which one
      // this actually is. Defaults to the more restrictive role if that
      // somehow comes back unclear, rather than assuming admin.
      resolvedRole = (await getAppKeyRole()) ?? 'viewer';
    } catch (err) {
      if (isNetworkError(err)) return "Can't verify right now — check your connection and try again.";
      return "That passphrase didn't work — try again.";
    }
    storePassphrase(passphrase, resolvedRole);
    setRole(resolvedRole);
    await loadAppData();
    return null;
  }

  useEffect(() => {
    const interval = setInterval(markActive, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Once back online, flush any ratings/memorized-toggles made while
  // offline, then reconcile with the server (another device may have
  // changed things meanwhile).
  useEffect(() => {
    async function handleOnline() {
      const { remaining } = await syncPendingWrites();
      setPendingCount(remaining);
      try {
        setSongs(await getSongs());
      } catch {
        return; // "online" event fired but a real request still fails — stay offline
      }
      setIsOffline(false);
    }
    function handleOffline() {
      setIsOffline(true);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    saveQueueState({ entries: queue, importedFromPlaylistId });
  }, [queue, importedFromPlaylistId]);

  function handleToggleQueue(song: Song) {
    setQueue((prev) =>
      prev.some((e) => e.songId === song.id)
        ? prev.filter((e) => e.songId !== song.id)
        : [...prev, { songId: song.id, leader: null }],
    );
  }

  function handleRemoveFromQueue(songId: string) {
    setQueue((prev) => prev.filter((e) => e.songId !== songId));
  }

  // Saving links the queue to the new playlist — further edits and a
  // subsequent "Update" target it, matching ordinary "Save As" behavior.
  async function handleSaveQueueAsNewPlaylist(name: string) {
    await runOrAlertOffline(async () => {
      const id = await createPlaylistFromQueue(name, queue);
      setPlaylists(await getPlaylists());
      setImportedFromPlaylistId(id);
    });
  }

  async function handleUpdatePlaylistFromQueue() {
    if (!importedFromPlaylistId) return;
    await runOrAlertOffline(async () => {
      await setPlaylistSongs(importedFromPlaylistId, queue);
      setPlaylists(await getPlaylists());
    });
  }

  async function handleOpenPlaylist(id: string) {
    await runOrAlertOffline(async () => {
      const detail = await getPlaylistDetail(id);
      setActivePlaylistId(id);
      setActivePlaylist(detail);
      setScreen('playlistDetail');
    });
  }

  async function handleRenamePlaylist(name: string) {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await renamePlaylist(activePlaylistId, name);
      const [detail, list] = await Promise.all([getPlaylistDetail(activePlaylistId), getPlaylists()]);
      setActivePlaylist(detail);
      setPlaylists(list);
    });
  }

  async function handleDeletePlaylist() {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await deletePlaylist(activePlaylistId);
      setPlaylists(await getPlaylists());
      if (importedFromPlaylistId === activePlaylistId) setImportedFromPlaylistId(null);
      setActivePlaylistId(null);
      setActivePlaylist(null);
      setScreen('playlists');
    });
  }

  async function handlePlaylistSetLeader(songId: string, leader: string | null) {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await setPlaylistSongLeader(activePlaylistId, songId, leader);
      setActivePlaylist(await getPlaylistDetail(activePlaylistId));
    });
  }

  async function handleReorderPlaylistSongs(orderedSongIds: string[]) {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await reorderPlaylistSongs(activePlaylistId, orderedSongIds);
      setActivePlaylist(await getPlaylistDetail(activePlaylistId));
    });
  }

  async function handleRemoveSongFromPlaylist(songId: string) {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await removeSongFromPlaylist(activePlaylistId, songId);
      const [detail, list] = await Promise.all([getPlaylistDetail(activePlaylistId), getPlaylists()]);
      setActivePlaylist(detail);
      setPlaylists(list);
    });
  }

  async function handleAddSongToPlaylistDetail(songId: string) {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await addSongToPlaylist(activePlaylistId, songId);
      const [detail, list] = await Promise.all([getPlaylistDetail(activePlaylistId), getPlaylists()]);
      setActivePlaylist(detail);
      setPlaylists(list);
    });
  }

  async function handleAddSongToPlaylistFromResults(playlistId: string, song: Song) {
    await runOrAlertOffline(async () => {
      await addSongToPlaylist(playlistId, song.id);
      setPlaylists(await getPlaylists());
      if (activePlaylistId === playlistId) setActivePlaylist(await getPlaylistDetail(playlistId));
    });
  }

  // No network needed — just seeds the queue from the already-loaded
  // playlist detail (including each song's leader, so it round-trips
  // through an edit-and-resave without needing to reassign anything).
  function handleLoadPlaylistIntoQueue() {
    if (!activePlaylist) return;
    setQueue(activePlaylist.songs.map((s) => ({ songId: s.songId, leader: s.leader })));
    setImportedFromPlaylistId(activePlaylist.id);
    setScreen('queue');
  }

  async function handleAddLeader(name: string) {
    await runOrAlertOffline(async () => {
      setLeaders(await addPlaylistLeader(name));
    });
  }

  async function handleRenameLeader(oldName: string, newName: string) {
    await runOrAlertOffline(async () => {
      setLeaders(await renamePlaylistLeader(oldName, newName));
      if (activePlaylistId) setActivePlaylist(await getPlaylistDetail(activePlaylistId));
    });
  }

  async function handleRemoveLeader(name: string) {
    await runOrAlertOffline(async () => {
      setLeaders(await removePlaylistLeader(name));
      if (activePlaylistId) setActivePlaylist(await getPlaylistDetail(activePlaylistId));
    });
  }

  async function handleReorderLeaders(orderedNames: string[]) {
    await runOrAlertOffline(async () => {
      setLeaders(await reorderPlaylistLeaders(orderedNames));
    });
  }

  // Switching spaces resets Filters/Sort to their defaults and clears the
  // queue/Random-10 selection — those hold song ids from the space being
  // left, which wouldn't resolve to anything in the new one. Rating scale
  // and leaders aren't refetched: both are shared across both spaces.
  async function handleSwitchSpace(next: Space) {
    if (next === space) return;
    setCurrentSpace(next);
    setSpaceState(next);
    saveSpace(next);
    setFilters({});
    setSortCriteria(DEFAULT_SORT_CRITERIA);
    setRandomTenIds(null);
    setQueue([]);
    setImportedFromPlaylistId(null);
    setShowFilters(false);
    setShowSort(false);
    setActiveSongId(null);
    setTagEditorSongId(null);
    setActivePlaylistId(null);
    setActivePlaylist(null);
    setScreen('results');
    try {
      const [s, c, p] = await Promise.all([getSongs(), getCategories(), getPlaylists()]);
      setSongs(s);
      setCategories(c);
      setPlaylists(p);
      setIsOffline(false);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      const cached = loadCachedSnapshot();
      setSongs(cached?.songs ?? []);
      setCategories(cached?.categories ?? []);
      setPlaylists([]);
      setIsOffline(true);
    }
  }

  async function runOrAlertOffline(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      window.alert("You're offline — this needs a connection.");
    }
  }

  function goScreen(next: Screen) {
    markActive();
    setScreen(next);
  }

  const filteredSongs = useMemo(() => {
    const scoped = randomTenIds ? songs.filter((s) => randomTenIds.includes(s.id)) : songs;
    return filterSongs(scoped, filters, categories, includeUntagged);
  }, [songs, filters, categories, includeUntagged, randomTenIds]);
  const sortedSongs = useMemo(
    () => sortSongs(filteredSongs, sortCriteria, ratingScale),
    [filteredSongs, sortCriteria, ratingScale],
  );

  const activeSong = songs.find((s) => s.id === activeSongId) ?? null;
  const tagEditorSong = songs.find((s) => s.id === tagEditorSongId) ?? null;

  const gapFillCategory = gapFillQueue ? (categories.find((c) => c.id === gapFillQueue.categoryId) ?? null) : null;
  const gapFillPosition = gapFillQueue
    ? gapFillAt(gapFillQueue, gapFillIndex)
    : { songId: null, phase: 'fill' as const, segmentLabel: '' };
  const gapFillSong = gapFillPosition.songId ? (songs.find((s) => s.id === gapFillPosition.songId) ?? null) : null;
  const gapFillQueueTotal = gapFillQueue ? gapFillTotal(gapFillQueue) : 0;

  const guidedPickerCategories = categories.filter((c) => c.guidedPickerEnabled !== false);
  const genreCategory = categories.find((c) => c.id === GENRE_CATEGORY_ID) ?? null;
  const activePickerCategories = pickerMode === 'genre' ? (genreCategory ? [genreCategory] : []) : guidedPickerCategories;
  const scatterPickerCategories = categories.filter((c) => c.scatterPickerEnabled && c.id !== GENRE_CATEGORY_ID);

  function applySongUpdate(updated: Song) {
    setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function startGuidedPicker() {
    setFilters({});
    setShowStaleness(false);
    setRandomTenIds(null);
    setPickerMode('full');
    setPickerStep(0);
    goScreen('picker');
  }

  // Jumps straight to the single Genre step instead of making people skip
  // through every other category first to reach it.
  function startGenrePicker() {
    setFilters({});
    setShowStaleness(false);
    setRandomTenIds(null);
    setPickerMode('genre');
    setPickerStep(0);
    goScreen('picker');
  }

  function startScatterPicker() {
    setFilters({});
    setShowStaleness(false);
    setRandomTenIds(null);
    goScreen('scatter');
  }

  // Memorized songs are always "Great" Performance Confidence (see
  // withComputedTags), so this is really one pool — songs you can already
  // play well, whether that's from memory or off the chart.
  function startRandomTen() {
    const pool = songs.filter((s) => s.memorized || s.tags.performance_confidence === 'Great');
    setFilters({});
    setShowStaleness(false);
    setRandomTenIds(shuffledSample(pool, 10).map((s) => s.id));
    goScreen('results');
  }

  function showAllSongs() {
    setFilters({});
    setShowStaleness(false);
    setRandomTenIds(null);
    goScreen('results');
  }

  function handleFilterChange(categoryId: string, filter: CategoryFilter | undefined) {
    setFilters((prev) => {
      const next = { ...prev };
      if (filter) next[categoryId] = filter;
      else delete next[categoryId];
      return next;
    });
  }

  function handleClearFilters() {
    setFilters({});
    setShowStaleness(false);
    setRandomTenIds(null);
  }

  // Staleness only applies to memorized songs, so showing it means showing
  // only memorized songs — this couples the toggle to the Memorized filter
  // in both directions rather than leaving them silently out of sync.
  function handleToggleStaleness(next: boolean) {
    setShowStaleness(next);
    setFilters((prev) => {
      const nextFilters = { ...prev };
      if (next) nextFilters.memorized = { values: ['Memorized'] };
      else delete nextFilters.memorized;
      return nextFilters;
    });
    setSortCriteria(
      next
        ? [{ key: 'staleness', direction: 'desc' }]
        : [
            { key: 'performance_confidence', direction: 'desc' },
            { key: 'artist', direction: 'asc' },
          ],
    );
  }

  // Jumping straight to a song's rating screen — from the Results row menu,
  // the Song Queue list, or Settings' "Find a Song" search. Only reachable
  // in admin contexts (those entry points are all canEdit-gated in the UI).
  function handleSelectSong(song: Song, origin: AssessmentOrigin = 'results') {
    if (openUgOnTap) window.open(song.ultimateGuitarUrl, '_blank', 'noopener');
    setActiveSongId(song.id);
    setActiveSongOrigin(origin);
    goScreen('assessment');
  }

  function handleOpenChordChartFromRow(song: Song) {
    setActiveSongId(song.id);
    setChordChartOrigin('results');
    goScreen('chordChart');
  }

  function handleToggleOpenUgOnTap(value: boolean) {
    setOpenUgOnTapState(value);
    try {
      localStorage.setItem(OPEN_UG_ON_TAP_KEY, String(value));
    } catch {
      // localStorage unavailable — preference just won't survive a reload
    }
  }

  async function handleRate(label: string) {
    if (!activeSong) return;
    const updated = await rateSong(activeSong.id, label);
    applySongUpdate(updated);
    setPendingCount(pendingWriteCount());
    handleRemoveFromQueue(activeSong.id);
    goScreen(activeSongOrigin);
  }

  function handleSkipAssessment() {
    goScreen(activeSongOrigin);
  }

  async function handleToggleMemorized(memorized: boolean) {
    if (!activeSong) return;
    const updated = await setMemorized(activeSong.id, memorized);
    applySongUpdate(updated);
    setPendingCount(pendingWriteCount());
  }

  async function handleUpdateTag(songId: string, categoryId: string, value: TagValue | null) {
    await runOrAlertOffline(async () => {
      const updated = await updateSongTag(songId, categoryId, value);
      applySongUpdate(updated);
    });
  }

  async function handleUpdateUrl(songId: string, url: string) {
    await runOrAlertOffline(async () => {
      const updated = await updateSongUrl(songId, url);
      applySongUpdate(updated);
    });
  }

  async function handleUpdateTitleArtist(songId: string, title: string, artist: string) {
    await runOrAlertOffline(async () => {
      const updated = await updateSongTitleArtist(songId, title, artist);
      applySongUpdate(updated);
    });
  }

  async function handleUpdateChordChart(songId: string, chordChart: string) {
    await runOrAlertOffline(async () => {
      const updated = await updateChordChart(songId, chordChart);
      applySongUpdate(updated);
    });
  }

  async function handleAddRecording(songId: string, title: string, file: File) {
    await runOrAlertOffline(async () => {
      const updated = await addSongRecording(songId, title, file);
      applySongUpdate(updated);
    });
  }

  async function handleRenameRecording(songId: string, recordingId: string, title: string) {
    await runOrAlertOffline(async () => {
      const updated = await renameSongRecording(songId, recordingId, title);
      applySongUpdate(updated);
    });
  }

  async function handleRemoveRecording(songId: string, recordingId: string) {
    await runOrAlertOffline(async () => {
      const updated = await removeSongRecording(songId, recordingId);
      applySongUpdate(updated);
    });
  }

  // Rating/memorized from the tag editor use the same rateSong/setMemorized
  // path as Assessment — same offline-queueing behavior — but stay on the
  // modal instead of navigating to Results afterward.
  async function handleTagEditorRate(songId: string, label: string) {
    const updated = await rateSong(songId, label);
    applySongUpdate(updated);
    setPendingCount(pendingWriteCount());
    handleRemoveFromQueue(songId);
  }

  async function handleTagEditorToggleMemorized(songId: string, memorized: boolean) {
    const updated = await setMemorized(songId, memorized);
    applySongUpdate(updated);
    setPendingCount(pendingWriteCount());
  }

  // Same routing Gap-Fill uses per category type — Memorized and the two
  // Confidence categories are computed, not plain tags, so a generic write
  // would just get silently overwritten on the next read. Memorized has no
  // "unset" state (it's a real boolean column, always one or the other) and
  // there's no "un-rate" action for a Confidence category, so tapping an
  // already-checked box in either is a no-op rather than trying to clear
  // it; every other category clears back to untagged like the rest of the
  // app's single-select pickers already do.
  async function handleMatrixSetTag(song: Song, categoryId: string, value: string) {
    if (categoryId === 'memorized') {
      const nextMemorized = value === 'Memorized';
      if (song.memorized === nextMemorized) return;
      await handleTagEditorToggleMemorized(song.id, nextMemorized);
      return;
    }
    if (categoryId === 'performance_confidence' || categoryId === 'memorization_confidence') {
      if (song.tags[categoryId] === value) return;
      await handleTagEditorRate(song.id, value);
      return;
    }
    const next = song.tags[categoryId] === value ? null : value;
    await handleUpdateTag(song.id, categoryId, next);
  }

  async function handleDeleteSong(songId: string) {
    await runOrAlertOffline(async () => {
      setSongs(await deleteSong(songId));
      setTagEditorSongId(null);
      handleRemoveFromQueue(songId);
      // The tag editor can be reached from Assessment via "Re-tag this
      // song" — if that's the song just deleted, Assessment would be left
      // rendering nothing (its song no longer exists), so land back on
      // Results explicitly rather than leaving whatever screen was behind.
      if (activeSongId === songId) setActiveSongId(null);
      goScreen('results');
    });
  }

  async function handleClearNotApplicable(song: Song, categoryId: string) {
    await runOrAlertOffline(async () => {
      const updated = await clearNotApplicable(song, categoryId);
      applySongUpdate(updated);
    });
  }

  function startGapFill(categoryId: string) {
    setGapFillMode('gaps');
    setGapFillQueue(buildGapFillQueue(songs, categoryId, 'gaps', ratingScale));
    setGapFillIndex(0);
    goScreen('gapfill');
  }

  function handleGapFillModeChange(mode: GapFillMode) {
    if (!gapFillQueue) return;
    setGapFillMode(mode);
    setGapFillQueue(buildGapFillQueue(songs, gapFillQueue.categoryId, mode, ratingScale));
    setGapFillIndex(0);
  }

  async function handleGapFillCommit(value: TagValue | null) {
    if (!gapFillQueue || !gapFillSong) return;
    // "Memorized" is backed by the real memorized boolean, and Performance
    // Confidence by lastRatingLabel — withComputedTags regenerates both
    // tags on every read, so writing through updateSongTag would just get
    // silently overwritten. Establishing a Performance Confidence this way
    // is the same act as rating the song, without requiring the song
    // actually be played first.
    if (gapFillQueue.categoryId === 'performance_confidence') {
      if (value == null) return; // no "un-rate" action — treat as a no-op rather than guess
      const updated = await rateSong(gapFillSong.id, value as string);
      applySongUpdate(updated);
      setPendingCount(pendingWriteCount());
      handleRemoveFromQueue(gapFillSong.id);
      setGapFillIndex((i) => i + 1);
      return;
    }
    const updated =
      gapFillQueue.categoryId === 'memorized'
        ? await setMemorized(gapFillSong.id, value === 'Memorized')
        : await updateSongTag(gapFillSong.id, gapFillQueue.categoryId, value);
    applySongUpdate(updated);
    setGapFillIndex((i) => i + 1);
  }

  function handleGapFillSkip() {
    setGapFillIndex((i) => i + 1);
  }

  async function handleGapFillMarkNotApplicable() {
    if (!gapFillQueue || !gapFillSong) return;
    await runOrAlertOffline(async () => {
      const updated = await markCategoryNotApplicable(gapFillSong, gapFillQueue.categoryId);
      applySongUpdate(updated);
      setGapFillIndex((i) => i + 1);
    });
  }

  function handleGapFillBack() {
    setGapFillIndex((i) => Math.max(0, i - 1));
  }

  function handleGapFillExit() {
    setGapFillQueue(null);
    setGapFillIndex(0);
    setGapFillMode('gaps');
    goScreen('settings');
  }

  async function handleAddCategory(name: string) {
    await runOrAlertOffline(async () => setCategories(await addCategory(name)));
  }

  async function handleRenameCategory(id: string, name: string) {
    await runOrAlertOffline(async () => setCategories(await renameCategory(id, name)));
  }

  async function handleRetireCategory(id: string) {
    await runOrAlertOffline(async () => setCategories(await retireCategory(id)));
  }

  async function handleReorderCategories(orderedIds: string[]) {
    await runOrAlertOffline(async () => setCategories(await reorderCategories(orderedIds)));
  }

  async function handleToggleGuidedPicker(id: string, enabled: boolean) {
    await runOrAlertOffline(async () => setCategories(await setCategoryGuidedPickerEnabled(id, enabled)));
  }

  async function handleToggleScatterPicker(id: string, enabled: boolean) {
    await runOrAlertOffline(async () => setCategories(await setCategoryScatterPickerEnabled(id, enabled)));
  }

  async function handleRenameValue(categoryId: string, oldValue: string, newValue: string) {
    await runOrAlertOffline(async () => {
      const result = await renameCategoryValue(categoryId, oldValue, newValue);
      setSongs(result.songs);
      setCategories(result.categories);
    });
  }

  async function handleDeleteValue(categoryId: string, value: string) {
    await runOrAlertOffline(async () => {
      const result = await deleteCategoryValue(categoryId, value);
      setSongs(result.songs);
      setCategories(result.categories);
    });
  }

  async function handleAddCategoryValue(categoryId: string, value: string) {
    await runOrAlertOffline(async () => setCategories(await addCategoryValue(categoryId, value)));
  }

  async function handleReorderValues(categoryId: string, orderedValues: string[]) {
    await runOrAlertOffline(async () => setCategories(await reorderCategoryValues(categoryId, orderedValues)));
  }

  async function handleAddRating(label: string, intervalDays: number) {
    await runOrAlertOffline(async () => setRatingScale(await addRatingEntry(label, intervalDays)));
  }

  async function handleUpdateRating(oldLabel: string, next: RatingScaleEntry) {
    await runOrAlertOffline(async () => {
      const result = await updateRatingEntry(oldLabel, next);
      setRatingScale(result.ratingScale);
      setSongs(result.songs);
    });
  }

  async function handleRemoveRating(label: string) {
    await runOrAlertOffline(async () => setRatingScale(await removeRatingEntry(label)));
  }

  async function handleAddSong(input: {
    title: string;
    artist: string;
    ultimateGuitarUrl: string;
    chordChart: string;
    tags: Record<string, TagValue>;
  }) {
    await runOrAlertOffline(async () => {
      setSongs(await addSong(input));
      goScreen('settings');
    });
  }

  if (screen === 'loading') {
    if (offlineUnavailable) {
      return (
        <div className="screen loading">
          No connection, and nothing saved yet to work from offline — connect once to load your library.
        </div>
      );
    }
    return <div className="screen loading">Loading your library…</div>;
  }

  return (
    <div className="app">
      {(isOffline || pendingCount > 0) && (
        <div className="offline-banner">
          {isOffline ? 'Offline — showing saved data' : 'Back online'}
          {pendingCount > 0 && ` · ${pendingCount} rating${pendingCount === 1 ? '' : 's'} waiting to sync`}
        </div>
      )}

      {screen === 'passphrase' && <PassphraseGate onSubmit={handlePassphraseSubmit} />}

      {screen === 'splash' && <Splash onFindSong={startGuidedPicker} onShowAll={showAllSongs} />}

      {screen === 'picker' && (
        <GuidedPicker
          categories={activePickerCategories}
          songs={songs}
          ratingScale={ratingScale}
          filters={filters}
          includeUntagged={includeUntagged}
          step={pickerStep}
          onStepChange={setPickerStep}
          onFilterChange={handleFilterChange}
          onShowResults={() => goScreen('results')}
        />
      )}

      {screen === 'scatter' && (
        <ScatterPicker
          categories={scatterPickerCategories}
          songs={songs}
          ratingScale={ratingScale}
          filters={filters}
          includeUntagged={includeUntagged}
          onFilterChange={handleFilterChange}
          onShowResults={() => goScreen('results')}
          onBack={() => goScreen('results')}
        />
      )}

      {screen === 'pickerChooser' && (
        <PickerChooser
          onBack={() => goScreen('results')}
          onStartGuidedPicker={startGuidedPicker}
          onStartGenrePicker={startGenrePicker}
          onStartScatterPicker={startScatterPicker}
          onStartRandomTen={startRandomTen}
        />
      )}

      {screen === 'results' && (
        <Results
          space={space}
          songs={sortedSongs}
          totalCount={songs.length}
          ratingScale={ratingScale}
          categories={categories}
          filters={filters}
          includeUntagged={includeUntagged}
          showStaleness={showStaleness}
          onToggleStaleness={handleToggleStaleness}
          onOpenFilters={() => setShowFilters(true)}
          onOpenSort={() => setShowSort(true)}
          onOpenSettings={() => goScreen('settings')}
          onOpenQueue={() => goScreen('queue')}
          onOpenPlaylists={() => goScreen('playlists')}
          onOpenMatrix={() => goScreen('matrix')}
          onOpenPickerChooser={() => goScreen('pickerChooser')}
          onToggleQueue={handleToggleQueue}
          onOpenAssessment={(song) => handleSelectSong(song, 'results')}
          onOpenChordChart={handleOpenChordChartFromRow}
          queue={queue}
          playlists={playlists}
          onAddSongToPlaylist={handleAddSongToPlaylistFromResults}
          canEdit={canEdit}
          isRandomTen={randomTenIds !== null}
        />
      )}

      {screen === 'settings' && (
        <Settings
          categories={categories}
          songs={songs}
          ratingScale={ratingScale}
          onBack={() => goScreen('results')}
          onAddCategory={handleAddCategory}
          onRenameCategory={handleRenameCategory}
          onRetireCategory={handleRetireCategory}
          onReorderCategories={handleReorderCategories}
          onToggleGuidedPicker={handleToggleGuidedPicker}
          onToggleScatterPicker={handleToggleScatterPicker}
          onRenameValue={handleRenameValue}
          onDeleteValue={handleDeleteValue}
          onAddValue={handleAddCategoryValue}
          onReorderValue={handleReorderValues}
          onStartGapFill={startGapFill}
          onAddRating={handleAddRating}
          onUpdateRating={handleUpdateRating}
          onRemoveRating={handleRemoveRating}
          onSelectSong={handleSelectSong}
          onOpenAddSong={() => goScreen('addsong')}
          openUgOnTap={openUgOnTap}
          onToggleOpenUgOnTap={handleToggleOpenUgOnTap}
          space={space}
          onSwitchSpace={handleSwitchSpace}
          leaders={leaders}
          onAddLeader={handleAddLeader}
          onRenameLeader={handleRenameLeader}
          onRemoveLeader={handleRemoveLeader}
          onReorderLeaders={handleReorderLeaders}
        />
      )}

      {screen === 'addsong' && (
        <AddSong
          space={space}
          categories={categories}
          songs={songs}
          onSave={handleAddSong}
          onCancel={() => goScreen('settings')}
        />
      )}

      {screen === 'queue' && (
        <SongQueue
          songs={queue.map((e) => songs.find((s) => s.id === e.songId)).filter((s): s is Song => !!s)}
          importedFromPlaylistName={playlists.find((p) => p.id === importedFromPlaylistId)?.name ?? null}
          onSelectSong={(song) => handleSelectSong(song, 'queue')}
          onRemove={handleRemoveFromQueue}
          onSaveAsNew={handleSaveQueueAsNewPlaylist}
          onUpdatePlaylist={handleUpdatePlaylistFromQueue}
          onBack={() => goScreen('results')}
        />
      )}

      {screen === 'playlists' && (
        <Playlists playlists={playlists} onOpenPlaylist={handleOpenPlaylist} onBack={() => goScreen('results')} />
      )}

      {screen === 'playlistDetail' && activePlaylist && (
        <PlaylistDetailScreen
          playlist={activePlaylist}
          allSongs={songs}
          leaders={leaders}
          onRename={handleRenamePlaylist}
          onDelete={handleDeletePlaylist}
          onSetLeader={handlePlaylistSetLeader}
          onReorder={handleReorderPlaylistSongs}
          onRemoveSong={handleRemoveSongFromPlaylist}
          onAddSong={handleAddSongToPlaylistDetail}
          onLoadIntoQueue={handleLoadPlaylistIntoQueue}
          onBack={() => goScreen('playlists')}
        />
      )}

      {screen === 'matrix' && (
        <Matrix
          songs={sortedSongs}
          categories={categories}
          ratingScale={ratingScale}
          onSetTag={handleMatrixSetTag}
          onBack={() => goScreen('results')}
        />
      )}

      {screen === 'gapfill' && gapFillCategory && (
        <GapFill
          key={gapFillSong?.id ?? 'gapfill-done'}
          category={gapFillCategory}
          song={gapFillSong}
          allSongs={songs}
          ratingScale={ratingScale}
          phase={gapFillPosition.phase}
          segmentLabel={gapFillPosition.segmentLabel}
          mode={gapFillMode}
          onModeChange={handleGapFillModeChange}
          current={gapFillIndex + 1}
          total={gapFillQueueTotal}
          canGoBack={gapFillIndex > 0}
          onCommit={handleGapFillCommit}
          onSkip={handleGapFillSkip}
          onMarkNotApplicable={handleGapFillMarkNotApplicable}
          onBack={handleGapFillBack}
          onExit={handleGapFillExit}
        />
      )}

      {screen === 'assessment' && activeSong && (
        <Assessment
          space={space}
          song={activeSong}
          ratingScale={ratingScale}
          onRate={handleRate}
          onToggleMemorized={handleToggleMemorized}
          onSkip={handleSkipAssessment}
          onRetag={(song) => setTagEditorSongId(song.id)}
          onOpenChordChart={() => {
            setChordChartOrigin('assessment');
            goScreen('chordChart');
          }}
          onBack={() => goScreen(activeSongOrigin)}
          backLabel={activeSongOrigin === 'queue' ? 'Back to queue' : 'Back to results'}
        />
      )}

      {screen === 'chordChart' && activeSong && (
        <ChordChartViewer
          song={activeSong}
          loadAudioUrl={getSongAudioUrl}
          onBack={() => goScreen(chordChartOrigin)}
        />
      )}

      {showFilters && (
        <FiltersPanel
          categories={categories}
          songs={songs}
          ratingScale={ratingScale}
          filters={filters}
          includeUntagged={includeUntagged}
          matchCount={filteredSongs.length}
          onFilterChange={handleFilterChange}
          onIncludeUntaggedChange={setIncludeUntagged}
          onClearAll={handleClearFilters}
          onClose={() => setShowFilters(false)}
        />
      )}

      {showSort && (
        <SortPanel
          categories={categories}
          criteria={sortCriteria}
          onChange={setSortCriteria}
          onClose={() => setShowSort(false)}
        />
      )}

      {tagEditorSong && (
        <SongTagEditor
          key={tagEditorSong.id}
          space={space}
          song={tagEditorSong}
          categories={categories}
          allSongs={songs}
          ratingScale={ratingScale}
          onClose={() => setTagEditorSongId(null)}
          onUpdateTag={(categoryId, value) => handleUpdateTag(tagEditorSong.id, categoryId, value)}
          onUpdateTitleArtist={(title, artist) => handleUpdateTitleArtist(tagEditorSong.id, title, artist)}
          onUpdateUrl={(url) => handleUpdateUrl(tagEditorSong.id, url)}
          onUpdateChordChart={(chordChart) => handleUpdateChordChart(tagEditorSong.id, chordChart)}
          onAddRecording={(title, file) => handleAddRecording(tagEditorSong.id, title, file)}
          onRenameRecording={(recordingId, title) => handleRenameRecording(tagEditorSong.id, recordingId, title)}
          onRemoveRecording={(recordingId) => handleRemoveRecording(tagEditorSong.id, recordingId)}
          loadAudioUrl={getSongAudioUrl}
          onToggleMemorized={(memorized) => handleTagEditorToggleMemorized(tagEditorSong.id, memorized)}
          onRate={(label) => handleTagEditorRate(tagEditorSong.id, label)}
          onDelete={() => handleDeleteSong(tagEditorSong.id)}
          onClearNotApplicable={(categoryId) => handleClearNotApplicable(tagEditorSong, categoryId)}
        />
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  Category,
  CategoryFilter,
  FilterState,
  PlaylistDetail,
  PlaylistHistory,
  PlaylistSummary,
  QueueEntry,
  RatingScaleEntry,
  Song,
  SortCriterion,
  TagValue,
  DatabaseInfo,
} from './types';
import {
  addCategory,
  addCategoryValue,
  addLibrarySong,
  addRatingEntry,
  clearNotApplicable,
  createDatabase,
  createSong,
  deleteCategoryValue,
  DuplicateSongError,
  findSongMatches,
  checkAdminCode,
  getGenreValues,
  listDatabases,
  relinkSongField,
  removeSongFromDatabase,
  searchLibrary,
  unlinkSongField,
  unlockDatabase,
  getCategories,
  getRatingScale,
  getSongs,
  loadCachedSnapshot,
  markCategoryNotApplicable,
  pendingWriteCount,
  previewSongChange,
  rateSong,
  removeRatingEntry,
  renameCategory,
  renameCategoryValue,
  reorderCategories,
  reorderCategoryValues,
  setCategorySkipLabel,
  retireCategory,
  setCategoryGuidedPickerEnabled,
  setCategoryScatterPickerEnabled,
  setCurrentDatabase,
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
  getPlaylistHistory,
  createPlaylistFromQueue,
  setPlaylistSongs,
  renamePlaylist,
  setPlaylistShowDate,
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
import { setAdminKey, setDatabaseCredentials } from './data/supabaseClient';
import { filterSongs, GENRE_CATEGORY_ID, shuffledSample, sortSongs } from './lib/filtering';
import { buildGapFillQueue, gapFillAt, gapFillTotal, type GapFillMode, type GapFillQueue } from './lib/gapfill';
import PasswordDialog from './screens/PasswordDialog';
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
import Databases from './screens/Databases';
import GlobalSettings from './screens/GlobalSettings';
import AddSong from './screens/AddSong';
import SongQueue from './screens/SongQueue';
import Playlists from './screens/Playlists';
import PlaylistDetailScreen from './screens/PlaylistDetail';
import PlaylistMatrix from './screens/PlaylistMatrix';
import Matrix from './screens/Matrix';
import { useResultsScrollMemory } from './lib/useResultsScrollMemory';
import { loadScrollSpeeds, saveScrollSpeeds, type ScrollSpeeds } from './lib/scrollSpeeds';
import SongTagEditor from './components/SongTagEditor';
import './App.css';

type Screen =
  | 'loading'
  | 'databases'
  | 'globalSettings'
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
  | 'playlistMatrix'
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

// The global admin code (edits the rating scale and genre values) is
// remembered on this device like a database password. RLS enforces both
// server-side; this is only the "don't ask again" convenience.
const ADMIN_KEY_KEY = 'songapp:adminKey:v1';

function loadAdminKey(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY_KEY);
  } catch {
    return null;
  }
}

function saveAdminKey(code: string | null) {
  try {
    if (code) localStorage.setItem(ADMIN_KEY_KEY, code);
    else localStorage.removeItem(ADMIN_KEY_KEY);
  } catch {
    // localStorage unavailable — the code is asked for again next time
  }
}

// The performance queue — songs (each carrying a leader, if it came from an
// imported playlist), in the order they were added. Purely a device-local
// session aid (not song data, and admin-only), so it lives in localStorage
// rather than the database. v2: entries carry a
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

// Each database has its own password. The ones this device has unlocked are
// remembered (like the app passphrase) so reopening one is a single tap, and
// the last-opened one is reopened automatically on launch.
const DB_KEYS_KEY = 'songapp:databaseKeys:v1';
const LAST_DB_KEY = 'songapp:lastDatabase:v1';
const DB_LIST_KEY = 'songapp:databaseList:v1';

function loadDbKeys(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DB_KEYS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDbKeys(keys: Record<string, string>) {
  try {
    localStorage.setItem(DB_KEYS_KEY, JSON.stringify(keys));
  } catch {
    // localStorage unavailable — databases just need unlocking again next load
  }
}

function loadLastDb(): string | null {
  try {
    return localStorage.getItem(LAST_DB_KEY);
  } catch {
    return null;
  }
}

function saveLastDb(id: string) {
  try {
    localStorage.setItem(LAST_DB_KEY, id);
  } catch {
    // localStorage unavailable — lands on the picker next load
  }
}

// Cached so a launch with no connection can still name the last database.
function loadDbList(): DatabaseInfo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DB_LIST_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDbList(list: DatabaseInfo[]) {
  try {
    localStorage.setItem(DB_LIST_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [categories, setCategories] = useState<Category[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [ratingScale, setRatingScale] = useState<RatingScaleEntry[]>([]);

  const [filters, setFilters] = useState<FilterState>({});
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const [search, setSearch] = useState('');
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
  const [scrollSpeeds, setScrollSpeedsState] = useState(loadScrollSpeeds);
  const [addSongOrigin, setAddSongOrigin] = useState<'settings' | 'results'>('settings');
  const [initialQueueState] = useState(loadQueueState);
  const [queue, setQueue] = useState<QueueEntry[]>(initialQueueState.entries);
  const [importedFromPlaylistId, setImportedFromPlaylistId] = useState<string | null>(
    initialQueueState.importedFromPlaylistId,
  );

  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [leaders, setLeaders] = useState<string[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<PlaylistDetail | null>(null);
  const [playlistHistory, setPlaylistHistory] = useState<PlaylistHistory | null>(null);

  const [gapFillQueue, setGapFillQueue] = useState<GapFillQueue | null>(null);
  const [gapFillIndex, setGapFillIndex] = useState(0);
  const [gapFillMode, setGapFillMode] = useState<GapFillMode>('gaps');

  // isOffline: last load/reconnect attempt used the cached snapshot instead
  // of a live fetch. offlineUnavailable: never been online, so there's no
  // cache to fall back to at all — a distinct dead-end from plain loading.
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const [pendingCount, setPendingCount] = useState(pendingWriteCount);

  // A database opens read-only for everyone; entering its password unlocks
  // editing. The admin code separately unlocks the global settings.
  const [canEdit, setCanEdit] = useState(false);
  const [adminCode, setAdminCode] = useState<string | null>(loadAdminKey);
  const [showUnlockPrompt, setShowUnlockPrompt] = useState(false);

  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [dbKeys, setDbKeys] = useState<Record<string, string>>(loadDbKeys);
  const [genreValues, setGenreValues] = useState<string[]>([]);
  const [globalSettingsOrigin, setGlobalSettingsOrigin] = useState<'settings' | 'databases'>('databases');
  // The database the saved queue belongs to — opening a different one clears it.
  const loadLastDbBeforeOpen = useRef<string | null>(loadLastDb());

  // landOn: a database opened read-only starts at the guided picker (a
  // browse-first view); an unlocked one starts at the full results list.
  async function loadAppData(landOn: 'results' | 'picker' = 'results') {
    function showLanding() {
      if (landOn === 'picker') {
        setFilters({});
        setShowStaleness(false);
        setRandomTenIds(null);
        setPickerMode('full');
        setPickerStep(0);
        setScreen('picker');
      } else {
        setScreen('results');
      }
    }
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
      showLanding();
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
      showLanding();
    }
  }

  // Opening a database scopes everything the app reads or writes to it: the
  // requests carry its password, and anything tied to the database we're
  // leaving (queue, filters, playlists) is dropped.
  async function openDatabase(next: DatabaseInfo, password: string | null) {
    const switching = database?.id !== next.id;
    setDatabaseCredentials(password ? { id: next.id, password } : null);
    setCanEdit(password !== null);
    setCurrentDatabase(next.id);
    setDatabase(next);
    saveLastDb(next.id);
    if (switching) {
      if (loadLastDbBeforeOpen.current !== next.id) setQueue([]);
      setImportedFromPlaylistId(null);
      setFilters({});
      setSearch('');
      setShowStaleness(false);
      setSortCriteria(DEFAULT_SORT_CRITERIA);
      setRandomTenIds(null);
      setShowFilters(false);
      setShowSort(false);
      setActiveSongId(null);
      setTagEditorSongId(null);
      setActivePlaylistId(null);
      setActivePlaylist(null);
      setSongs([]);
      setCategories([]);
      setPlaylists([]);
      setLeaders([]);
    }
    loadLastDbBeforeOpen.current = next.id;
    setScreen('loading');
    await loadAppData(password === null ? 'picker' : 'results');
  }

  // On launch: reopen the database that was open last time — unlocked if this
  // device still has its password, read-only if not — or show the picker.
  async function enterApp() {
    try {
      const list = await listDatabases();
      setDatabases(list);
      saveDbList(list);
      const last = list.find((d) => d.id === loadLastDb());
      if (!last) {
        setScreen('databases');
        return;
      }
      const key = loadDbKeys()[last.id];
      await openDatabase(last, key && (await unlockDatabase(last.id, key)) ? key : null);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // No connection: reopen the last database from its saved copy, if any.
      const list = loadDbList();
      setDatabases(list);
      const last = list.find((d) => d.id === loadLastDb());
      if (last) {
        const key = loadDbKeys()[last.id] ?? null;
        setDatabaseCredentials(key ? { id: last.id, password: key } : null);
        setCanEdit(key !== null);
        setCurrentDatabase(last.id);
        setDatabase(last);
        loadLastDbBeforeOpen.current = last.id;
        await loadAppData(key === null ? 'picker' : 'results');
      } else {
        setOfflineUnavailable(true);
      }
    }
  }

  useEffect(() => {
    setAdminKey(adminCode);
    enterApp();
    // Runs once on launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolves to an error message, or null once the database is open.
  async function handleUnlockDatabase(target: DatabaseInfo, password: string): Promise<string | null> {
    try {
      if (!(await unlockDatabase(target.id, password))) return "That password didn't work — try again.";
    } catch (err) {
      if (isNetworkError(err)) return "Can't verify right now — check your connection and try again.";
      return "That password didn't work — try again.";
    }
    const keys = { ...dbKeys, [target.id]: password };
    setDbKeys(keys);
    saveDbKeys(keys);
    await openDatabase(target, password);
    return null;
  }

  // Opens a database: editable if this device has its password and the server
  // still accepts it, read-only otherwise. A stale saved password is dropped.
  async function handleOpenDatabase(target: DatabaseInfo) {
    const password = dbKeys[target.id];
    if (!password) {
      await openDatabase(target, null);
      return;
    }
    try {
      if (!(await unlockDatabase(target.id, password))) {
        const keys = { ...dbKeys };
        delete keys[target.id];
        setDbKeys(keys);
        saveDbKeys(keys);
        window.alert(`The password for ${target.name} has changed — opening it read-only. Unlock it again to edit.`);
        await openDatabase(target, null);
        return;
      }
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // Offline: trust the saved password and use the saved copy of the data.
    }
    await openDatabase(target, password);
  }

  // "Unlock to edit" on the database that's already open.
  async function handleUnlockCurrent(password: string): Promise<string | null> {
    if (!database) return 'No database is open.';
    try {
      if (!(await unlockDatabase(database.id, password))) return "That password didn't work — try again.";
    } catch (err) {
      if (isNetworkError(err)) return "Can't verify right now — check your connection and try again.";
      return "That password didn't work — try again.";
    }
    const keys = { ...dbKeys, [database.id]: password };
    setDbKeys(keys);
    saveDbKeys(keys);
    setDatabaseCredentials({ id: database.id, password });
    setCanEdit(true);
    setShowUnlockPrompt(false);
    return null;
  }

  // Global settings: check the admin code with the server before keeping it.
  async function handleUnlockAdmin(code: string): Promise<string | null> {
    try {
      if (!(await checkAdminCode(code))) return "That passphrase didn't work — try again.";
    } catch (err) {
      if (isNetworkError(err)) return "Can't verify right now — check your connection and try again.";
      return "That passphrase didn't work — try again.";
    }
    setAdminKey(code);
    saveAdminKey(code);
    setAdminCode(code);
    return null;
  }

  async function handleCreateDatabase(
    name: string,
    password: string,
    createCode: string,
    ugSearchFallback: boolean,
  ): Promise<string | null> {
    try {
      const id = await createDatabase(name, password, createCode, ugSearchFallback);
      const list = await listDatabases();
      setDatabases(list);
      saveDbList(list);
      const created = list.find((d) => d.id === id);
      if (!created) return 'The database was created but could not be opened — pick it from the list.';
      const keys = { ...dbKeys, [id]: password };
      setDbKeys(keys);
      saveDbKeys(keys);
      await openDatabase(created, password);
      return null;
    } catch (err) {
      if (isNetworkError(err)) return "You're offline — creating a database needs a connection.";
      return err instanceof Error ? err.message : 'Could not create the database.';
    }
  }

  async function handleOpenGlobalSettings(origin: 'settings' | 'databases') {
    setGlobalSettingsOrigin(origin);
    try {
      const [genres, ratings] = await Promise.all([getGenreValues(), getRatingScale()]);
      setGenreValues(genres);
      setRatingScale(ratings);
    } catch {
      // Falls back to whatever was loaded; the screen still opens.
    }
    goScreen('globalSettings');
  }

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
  async function handleSaveQueueAsNewPlaylist(name: string, showDate: string | null) {
    await runOrAlertOffline(async () => {
      const id = await createPlaylistFromQueue(name, queue, showDate);
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

  async function handleOpenPlaylistMatrix() {
    await runOrAlertOffline(async () => {
      setPlaylistHistory(await getPlaylistHistory());
      setScreen('playlistMatrix');
    });
  }

  async function handleSetPlaylistDate(showDate: string | null) {
    if (!activePlaylistId) return;
    await runOrAlertOffline(async () => {
      await setPlaylistShowDate(activePlaylistId, showDate);
      const [detail, list] = await Promise.all([getPlaylistDetail(activePlaylistId), getPlaylists()]);
      setActivePlaylist(detail);
      setPlaylists(list);
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

  async function handleAddLeader(name: string): Promise<boolean> {
    return runOrAlertOffline(async () => {
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

  // Returns whether the action succeeded. Non-network failures (a rejected
  // write, a constraint violation) are surfaced too — rethrowing them from a
  // click handler just becomes an unhandled rejection the user never sees,
  // which reads as "the button does nothing."
  function reportFailure(err: unknown) {
    if (isNetworkError(err)) {
      window.alert("You're offline — this needs a connection.");
    } else {
      console.error(err);
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message;
      window.alert(`That didn't save${message ? `: ${message}` : '.'}`);
    }
  }

  async function runOrAlertOffline(action: () => Promise<void>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (err) {
      reportFailure(err);
      return false;
    }
  }

  function goScreen(next: Screen) {
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

  // The search box narrows what Results (and the Matrix, which shows
  // "whatever Results shows") display, but not the Filters panel's own match
  // count — that describes the filters alone.
  const visibleSongs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sortedSongs;
    return sortedSongs.filter(
      (s) => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query),
    );
  }, [sortedSongs, search]);

  const resultsListKey = useMemo(
    () => JSON.stringify({ filters, includeUntagged, sortCriteria, randomTenIds, db: database?.id, search }),
    [filters, includeUntagged, sortCriteria, randomTenIds, database?.id, search],
  );
  useResultsScrollMemory(screen, resultsListKey);

  // A search is for finding one song; coming back to Results starts from the
  // full list again. A layout effect so the cleared list is what first paints.
  useLayoutEffect(() => {
    if (screen === 'results') setSearch('');
  }, [screen]);

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
        ? [
            { key: 'staleness', direction: 'desc' },
            { key: 'title', direction: 'asc' },
          ]
        : DEFAULT_SORT_CRITERIA,
    );
  }

  // Jumping straight to a song's rating screen — from the Results row menu
  // or the Song Queue list. Only reachable in admin contexts (those entry
  // points are all canEdit-gated in the UI).
  function handleSelectSong(song: Song, origin: AssessmentOrigin = 'results') {
    if (!canEdit) return;
    setActiveSongId(song.id);
    setActiveSongOrigin(origin);
    goScreen('assessment');
  }

  function handleOpenChordChartFromRow(song: Song) {
    setActiveSongId(song.id);
    setChordChartOrigin('results');
    goScreen('chordChart');
  }

  function handleChangeScrollSpeeds(next: ScrollSpeeds) {
    setScrollSpeedsState(next);
    saveScrollSpeeds(next);
  }

  // Rating shows its result and returns right away; the database write
  // finishes in the background. If the server rejects it (a network drop is
  // handled separately — that gets queued for later), the song goes back to
  // how it was and the user is told, rather than leaving a rating on screen
  // that was never saved.
  function handleRate(label: string) {
    if (!activeSong) return;
    const before = activeSong;
    applySongUpdate(
      previewSongChange(before, {
        lastRatingLabel: label,
        lastPlayedAt: new Date().toISOString(),
        playCount: before.playCount + 1,
      }),
    );
    handleRemoveFromQueue(before.id);
    goScreen(activeSongOrigin);
    rateSong(before.id, label).then(
      (updated) => {
        applySongUpdate(updated);
        setPendingCount(pendingWriteCount());
      },
      (err) => {
        console.error(err);
        applySongUpdate(before);
        window.alert(`Couldn't save the rating for "${before.title}", so it was undone. Please try again.`);
      },
    );
  }

  function handleSkipAssessment() {
    goScreen(activeSongOrigin);
  }

  function handleToggleMemorized(memorized: boolean) {
    if (!activeSong) return;
    const before = activeSong;
    applySongUpdate(previewSongChange(before, { memorized }));
    setMemorized(before.id, memorized).then(
      (updated) => {
        applySongUpdate(updated);
        setPendingCount(pendingWriteCount());
      },
      (err) => {
        console.error(err);
        applySongUpdate(before);
        window.alert(`Couldn't save that change for "${before.title}", so it was undone. Please try again.`);
      },
    );
  }

  async function handleUpdateTag(songId: string, categoryId: string, value: TagValue | null) {
    await runOrAlertOffline(async () => {
      const updated = await updateSongTag(songId, categoryId, value);
      applySongUpdate(updated);
    });
  }

  async function handleUpdateUrl(songId: string, url: string) {
    const song = songs.find((s) => s.id === songId);
    if (!song) return;
    await runOrAlertOffline(async () => {
      const updated = await updateSongUrl(song, url);
      applySongUpdate(updated);
    });
  }

  async function handleUpdateTitleArtist(songId: string, title: string, artist: string) {
    const song = songs.find((s) => s.id === songId);
    if (!song) return;
    await runOrAlertOffline(async () => {
      const updated = await updateSongTitleArtist(song, title, artist);
      applySongUpdate(updated);
    });
  }

  async function handleUnlinkField(songId: string, field: 'lyrics' | 'genre') {
    await runOrAlertOffline(async () => applySongUpdate(await unlinkSongField(songId, field)));
  }

  async function handleRelinkField(songId: string, field: 'lyrics' | 'genre') {
    await runOrAlertOffline(async () => applySongUpdate(await relinkSongField(songId, field)));
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
    const song = songs.find((s) => s.id === songId);
    if (!song) return;
    await runOrAlertOffline(async () => {
      setSongs(await removeSongFromDatabase(song));
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

  async function handleChangeSkipLabel(categoryId: string, label: string) {
    await runOrAlertOffline(async () => setCategories(await setCategorySkipLabel(categoryId, label)));
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

  // Rejects with DuplicateSongError (so the Add Song screen can show its
  // confirmation) when the library already has something that looks like it;
  // any other failure is reported here.
  async function handleCreateSong(
    input: {
      title: string;
      artist: string;
      ultimateGuitarUrl: string;
      chordChart: string;
      tags: Record<string, TagValue>;
    },
    confirmedDifferent: boolean,
  ) {
    try {
      setSongs(await createSong(input, confirmedDifferent));
      goScreen(addSongOrigin);
    } catch (err) {
      if (err instanceof DuplicateSongError) throw err;
      reportFailure(err);
    }
  }

  async function handleAddExistingSong(sharedSongId: string): Promise<boolean> {
    return runOrAlertOffline(async () => {
      setSongs(await addLibrarySong(sharedSongId));
    });
  }

  // Genre values are global, so changing them also has to refresh the list the
  // Global Settings screen shows (it can be open with no database loaded).
  async function refreshGenreValues() {
    setGenreValues(await getGenreValues());
  }

  async function handleRenameGenre(oldValue: string, newValue: string) {
    await runOrAlertOffline(async () => {
      const result = await renameCategoryValue('genre_2', oldValue, newValue);
      setSongs(result.songs);
      setCategories(result.categories);
      await refreshGenreValues();
    });
  }

  async function handleDeleteGenre(value: string) {
    await runOrAlertOffline(async () => {
      const result = await deleteCategoryValue('genre_2', value);
      setSongs(result.songs);
      setCategories(result.categories);
      await refreshGenreValues();
    });
  }

  async function handleAddGenre(value: string) {
    await runOrAlertOffline(async () => {
      setCategories(await addCategoryValue('genre_2', value));
      await refreshGenreValues();
    });
  }

  async function handleReorderGenre(orderedValues: string[]) {
    await runOrAlertOffline(async () => {
      setCategories(await reorderCategoryValues('genre_2', orderedValues));
      await refreshGenreValues();
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

      {screen === 'databases' && (
        <Databases
          databases={databases}
          unlockedIds={new Set(Object.keys(dbKeys))}
          currentId={database?.id ?? null}
          onOpen={handleOpenDatabase}
          onUnlock={handleUnlockDatabase}
          onCreate={handleCreateDatabase}
          onOpenGlobalSettings={() => handleOpenGlobalSettings('databases')}
          onBack={database ? () => goScreen('results') : null}
        />
      )}

      {screen === 'globalSettings' && (
        <GlobalSettings
          ratingScale={ratingScale}
          genreValues={genreValues}
          songs={songs}
          canEdit={adminCode !== null}
          onUnlockAdmin={handleUnlockAdmin}
          onAddRating={handleAddRating}
          onUpdateRating={handleUpdateRating}
          onRemoveRating={handleRemoveRating}
          onRenameGenre={handleRenameGenre}
          onDeleteGenre={handleDeleteGenre}
          onAddGenre={handleAddGenre}
          onReorderGenre={handleReorderGenre}
          onBack={() => goScreen(globalSettingsOrigin)}
        />
      )}


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
          ugSearchFallback={database?.ugSearchFallback ?? false}
          songs={visibleSongs}
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
          onOpenDatabases={() => goScreen('databases')}
          onOpenAddSong={() => {
            setAddSongOrigin('results');
            goScreen('addsong');
          }}
          onOpenPickerChooser={() => goScreen('pickerChooser')}
          onToggleQueue={handleToggleQueue}
          onOpenAssessment={(song) => handleSelectSong(song, 'results')}
          onOpenChordChart={handleOpenChordChartFromRow}
          queue={queue}
          playlists={playlists}
          onAddSongToPlaylist={handleAddSongToPlaylistFromResults}
          canEdit={canEdit}
          isRandomTen={randomTenIds !== null}
          search={search}
          onSearchChange={setSearch}
          databaseName={database?.name ?? ''}
          onRequestUnlock={() => setShowUnlockPrompt(true)}
        />
      )}

      {screen === 'settings' && (
        <Settings
          database={database ?? { id: '', name: 'Database', ugSearchFallback: false }}
          onSwitchDatabase={() => goScreen('databases')}
          onOpenGlobalSettings={() => handleOpenGlobalSettings('settings')}
          categories={categories}
          songs={songs}
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
          onChangeSkipLabel={handleChangeSkipLabel}
          onStartGapFill={startGapFill}
          onOpenAddSong={() => {
            setAddSongOrigin('settings');
            goScreen('addsong');
          }}
          scrollSpeeds={scrollSpeeds}
          onChangeScrollSpeeds={handleChangeScrollSpeeds}
          leaders={leaders}
          onAddLeader={handleAddLeader}
          onRenameLeader={handleRenameLeader}
          onRemoveLeader={handleRemoveLeader}
          onReorderLeaders={handleReorderLeaders}
        />
      )}

      {screen === 'addsong' && (
        <AddSong
          database={database ?? { id: '', name: 'this database', ugSearchFallback: false }}
          categories={categories}
          songs={songs}
          backLabel={addSongOrigin === 'results' ? 'Back to results' : 'Back to settings'}
          onCancel={() => goScreen(addSongOrigin)}
          onSearchLibrary={searchLibrary}
          onAddExisting={handleAddExistingSong}
          onFindMatches={findSongMatches}
          onSave={handleCreateSong}
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
        <Playlists
          playlists={playlists}
          onOpenPlaylist={handleOpenPlaylist}
          onOpenMatrix={handleOpenPlaylistMatrix}
          onBack={() => goScreen('results')}
        />
      )}

      {screen === 'playlistMatrix' && playlistHistory && (
        <PlaylistMatrix history={playlistHistory} onBack={() => goScreen('playlists')} />
      )}

      {screen === 'playlistDetail' && activePlaylist && (
        <PlaylistDetailScreen
          playlist={activePlaylist}
          allSongs={songs}
          leaders={leaders}
          onRename={handleRenamePlaylist}
          onSetDate={handleSetPlaylistDate}
          onDelete={handleDeletePlaylist}
          onSetLeader={handlePlaylistSetLeader}
          onReorder={handleReorderPlaylistSongs}
          onRemoveSong={handleRemoveSongFromPlaylist}
          onAddSong={handleAddSongToPlaylistDetail}
          onLoadIntoQueue={handleLoadPlaylistIntoQueue}
          canEdit={canEdit}
          onBack={() => goScreen('playlists')}
        />
      )}

      {screen === 'matrix' && (
        <Matrix
          songs={visibleSongs}
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
          ugSearchFallback={database?.ugSearchFallback ?? false}
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
          speeds={scrollSpeeds}
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

      {showUnlockPrompt && database && (
        <PasswordDialog
          title={`Unlock ${database.name}`}
          subtitle="Enter this database's password to edit it."
          placeholder={`Password for ${database.name}`}
          onSubmit={handleUnlockCurrent}
          onCancel={() => setShowUnlockPrompt(false)}
        />
      )}

      {tagEditorSong && (
        <SongTagEditor
          // Unlinking/relinking lyrics swaps which text the editor shows, so it starts fresh.
          key={`${tagEditorSong.id}:${tagEditorSong.lyricsUnlinked}`}
          ugSearchFallback={database?.ugSearchFallback ?? false}
          ownerName={databases.find((d) => d.id === tagEditorSong.ownerDbId)?.name ?? 'another database'}
          song={tagEditorSong}
          categories={categories}
          allSongs={songs}
          ratingScale={ratingScale}
          onClose={() => setTagEditorSongId(null)}
          onUpdateTag={(categoryId, value) => handleUpdateTag(tagEditorSong.id, categoryId, value)}
          onUpdateTitleArtist={(title, artist) => handleUpdateTitleArtist(tagEditorSong.id, title, artist)}
          onUpdateUrl={(url) => handleUpdateUrl(tagEditorSong.id, url)}
          onUpdateChordChart={(chordChart) => handleUpdateChordChart(tagEditorSong.id, chordChart)}
          onUnlinkField={(field) => handleUnlinkField(tagEditorSong.id, field)}
          onRelinkField={(field) => handleRelinkField(tagEditorSong.id, field)}
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

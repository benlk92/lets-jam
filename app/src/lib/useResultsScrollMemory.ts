import { useEffect, useLayoutEffect, useRef } from 'react';

// How long after leaving Results a "back" still lands where you were. Past
// this you've likely moved on, and the top is the better place to start.
const MAX_AGE_MS = 30 * 60 * 1000;

// Screens that are "children" of Results — coming back from one of these is a
// back-navigation. Anything else (the pickers, Settings, a fresh launch) is a
// new visit and starts at the top.
const CHILD_SCREENS = new Set(['assessment', 'chordChart', 'queue', 'playlists', 'playlistDetail', 'matrix']);

// Same rule browsers use for history: back restores your position, a new
// visit starts at the top. The extra condition is `listKey` — if the filters,
// sort, or space changed, the list is a different list, so the old position
// means nothing and we also jump to the top the moment it changes.
export function useResultsScrollMemory(screen: string, listKey: string) {
  const screenRef = useRef(screen);
  const prevScreenRef = useRef(screen);
  const listKeyRef = useRef(listKey);
  const saved = useRef({ y: 0, key: listKey, leftAt: 0 });

  // Must stay first: the effects below read these refs, and layout effects
  // run in declaration order, all before the browser paints.
  useLayoutEffect(() => {
    screenRef.current = screen;
    listKeyRef.current = listKey;
  });

  // Gated on the *current* screen so the scroll event the browser fires when
  // the page shrinks after leaving Results can't overwrite the saved position.
  useEffect(() => {
    function handleScroll() {
      if (screenRef.current !== 'results') return;
      saved.current.y = window.scrollY;
      saved.current.key = listKeyRef.current;
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useLayoutEffect(() => {
    const prev = prevScreenRef.current;
    prevScreenRef.current = screen;
    if (prev === screen) return;

    if (prev === 'results') {
      saved.current.leftAt = Date.now();
      return;
    }
    if (screen !== 'results') return;

    const { y, key, leftAt } = saved.current;
    const canRestore = CHILD_SCREENS.has(prev) && key === listKey && Date.now() - leftAt < MAX_AGE_MS;
    window.scrollTo(0, canRestore ? y : 0);
  }, [screen, listKey]);

  useLayoutEffect(() => {
    if (screenRef.current === 'results') window.scrollTo(0, 0);
  }, [listKey]);
}

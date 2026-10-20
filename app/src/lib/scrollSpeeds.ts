// Lyrics auto-scroll speeds, in pixels per second. A device-local reading
// preference (phones and tablets differ), so it lives in localStorage rather
// than the database.
export interface ScrollSpeeds {
  slow: number;
  medium: number;
  fast: number;
}

export const DEFAULT_SCROLL_SPEEDS: ScrollSpeeds = { slow: 9, medium: 18, fast: 35 };

export const MIN_SCROLL_SPEED = 1;
export const MAX_SCROLL_SPEED = 300;

const SCROLL_SPEEDS_KEY = 'songapp:scrollSpeeds';

function isValidSpeed(value: unknown): value is number {
  return typeof value === 'number' && value >= MIN_SCROLL_SPEED && value <= MAX_SCROLL_SPEED;
}

export function loadScrollSpeeds(): ScrollSpeeds {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCROLL_SPEEDS_KEY) ?? 'null');
    return {
      slow: isValidSpeed(parsed?.slow) ? parsed.slow : DEFAULT_SCROLL_SPEEDS.slow,
      medium: isValidSpeed(parsed?.medium) ? parsed.medium : DEFAULT_SCROLL_SPEEDS.medium,
      fast: isValidSpeed(parsed?.fast) ? parsed.fast : DEFAULT_SCROLL_SPEEDS.fast,
    };
  } catch {
    return DEFAULT_SCROLL_SPEEDS;
  }
}

export function saveScrollSpeeds(speeds: ScrollSpeeds) {
  try {
    localStorage.setItem(SCROLL_SPEEDS_KEY, JSON.stringify(speeds));
  } catch {
    // Storage unavailable (private mode) — the choice just won't outlive the session.
  }
}

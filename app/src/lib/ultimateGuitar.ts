// Ultimate Guitar tab URLs look like
// tabs.ultimate-guitar.com/tab/{artist-slug}/{title-slug}-{type}-{id}, e.g.
// .../tab/4-non-blondes/whats-up-chords-349210. Slugs drop punctuation
// (apostrophes, etc.), so the derived title/artist are a starting point to
// fix up, not guaranteed exact — same tradeoff the original song_import.csv
// data has for titles like "Whats Up".
const TRAILING_TAB_TYPE_WORDS = ['chords', 'tabs', 'tab', 'pro', 'ukulele', 'official'];

// A real UG slug is just lowercase letters/digits separated by single
// hyphens — anything else (stray spaces, symbols) means this isn't a slug
// worth guessing a title/artist from.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugToWords(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// No saved link for this song — send them to a UG title search instead of
// a dead end.
export function buildUltimateGuitarSearchUrl(title: string): string {
  return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(title)}`;
}

export function parseUltimateGuitarUrl(url: string): { artist: string; title: string } | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url.trim()).pathname);
  } catch {
    return null;
  }

  const match = pathname.match(/^\/tab\/([^/]+)\/([^/]+)\/?$/);
  if (!match) return null;
  const [, artistSlug, rawTitleSlug] = match;
  if (!SLUG_PATTERN.test(artistSlug) || !SLUG_PATTERN.test(rawTitleSlug)) return null;

  let titleSlug = rawTitleSlug.replace(/-\d+$/, '');
  const lastWord = titleSlug.slice(titleSlug.lastIndexOf('-') + 1);
  if (TRAILING_TAB_TYPE_WORDS.includes(lastWord)) {
    titleSlug = titleSlug.slice(0, -(lastWord.length + 1));
  }
  if (!artistSlug || !titleSlug) return null;

  return { artist: slugToWords(artistSlug), title: slugToWords(titleSlug) };
}

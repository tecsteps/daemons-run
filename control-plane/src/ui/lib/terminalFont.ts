// Adapted from old daemons-run (tag pre-pivot-2026-09-05) resources/js/lib/terminalFontSize.ts.
export const TERMINAL_FONT_FAMILY = '"Geist Mono Terminal", "Geist Mono", Menlo, Consolas, ui-monospace, monospace';
export const FONT_SIZES = { min: 10, max: 22 };
const FONT_KEY = 'daemons:terminal-font-size';

const phone = () => window.matchMedia('(max-width: 47.999rem)').matches;

export function defaultFontSize() {
  try {
    const stored = Number(localStorage.getItem(FONT_KEY));
    if (stored >= FONT_SIZES.min && stored <= FONT_SIZES.max) return stored;
  } catch {}
  return phone() ? 12 : 14;
}

export function resetFontSize() {
  return phone() ? 12 : 14;
}

export function clampFontSize(size: number) {
  return Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, Math.round(size)));
}

export function saveFontSize(size: number) {
  try {
    localStorage.setItem(FONT_KEY, String(size));
  } catch {
    // The live terminal keeps the size when storage is blocked.
  }
}

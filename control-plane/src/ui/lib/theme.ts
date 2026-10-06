// Adapted from old daemons-run resources/js/lib/theme.ts
export type ThemePreference = 'system' | 'light' | 'dark';

export function currentThemePreference(): ThemePreference {
  const p = document.documentElement.dataset.themePreference;
  return p === 'light' || p === 'dark' ? p : 'system';
}

export function applyThemePreference(preference: ThemePreference) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
  try {
    localStorage.setItem('daemons:theme', preference);
  } catch {}
}

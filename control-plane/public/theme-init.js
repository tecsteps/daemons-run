// Adapted from old daemons-run public/theme-init.js: apply the theme before first paint.
(function () {
  var root = document.documentElement;
  var preference = 'system';
  try {
    preference = localStorage.getItem('daemons:theme') || 'system';
  } catch (e) {}
  if (['system', 'light', 'dark'].indexOf(preference) < 0) preference = 'system';
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
})();

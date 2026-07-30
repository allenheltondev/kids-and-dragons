/**
 * Theme toggle click handler.
 *
 * Manages dark/light mode toggling via the #theme-toggle button.
 * - Toggles `dark` class on <html>
 * - Swaps visible icon (sun ↔ moon)
 * - Persists preference to localStorage ("wiki-theme" key)
 * - Gracefully handles localStorage errors (session-only toggle)
 */
(function () {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  /**
   * Update icon visibility to match the current theme.
   * Sun icon shows in dark mode (offers "switch to light").
   * Moon icon shows in light mode (offers "switch to dark").
   */
  function updateIcons() {
    var isDark = document.documentElement.classList.contains('dark');
    var sunIcon = btn.querySelector('.wiki-theme-toggle__icon--sun');
    var moonIcon = btn.querySelector('.wiki-theme-toggle__icon--moon');
    if (sunIcon) sunIcon.style.display = isDark ? '' : 'none';
    if (moonIcon) moonIcon.style.display = isDark ? 'none' : '';
  }

  /**
   * Persist theme value to localStorage. Silently swallows errors
   * so the toggle still works even when storage is unavailable
   * (e.g. private browsing, quota exceeded).
   */
  function persist(theme) {
    try {
      localStorage.setItem('wiki-theme', theme);
    } catch (e) {
      // Session-only toggle — no crash
    }
  }

  // Set initial icon state on script load
  updateIcons();

  btn.addEventListener('click', function () {
    document.documentElement.classList.toggle('dark');
    var isDark = document.documentElement.classList.contains('dark');
    updateIcons();
    persist(isDark ? 'dark' : 'light');
  });
})();

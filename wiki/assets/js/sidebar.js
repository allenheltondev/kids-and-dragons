/**
 * Mobile sidebar overlay toggle.
 *
 * Manages the mobile sidebar via the #sidebar-toggle hamburger button.
 * - Toggles `.wiki-sidebar--open` class on #wiki-sidebar
 * - Shows/hides #sidebar-backdrop
 * - Sets `aria-expanded` on the toggle button
 * - Locks body scroll while sidebar is open
 * - Closes on backdrop click or hamburger re-click
 */
(function () {
  var toggle = document.getElementById('sidebar-toggle');
  var sidebar = document.getElementById('wiki-sidebar');
  var backdrop = document.getElementById('sidebar-backdrop');

  // Bail out gracefully if elements are not present
  if (!toggle || !sidebar || !backdrop) return;

  function openSidebar() {
    sidebar.classList.add('wiki-sidebar--open');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('wiki-sidebar--open');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', function () {
    if (sidebar.classList.contains('wiki-sidebar--open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  backdrop.addEventListener('click', closeSidebar);
})();

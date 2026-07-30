/**
 * Navbar Scroll Detection
 *
 * Toggles `.wiki-navbar--scrolled` on the navbar element when the page is
 * scrolled past the top (scrollY > 0). Uses requestAnimationFrame for
 * paint-aligned class toggling and a passive scroll listener to avoid
 * blocking the main thread.
 */
(function () {
  var navbar = document.getElementById('wiki-navbar');
  if (!navbar) return;

  var ticking = false;

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(function () {
        navbar.classList.toggle('wiki-navbar--scrolled', window.scrollY > 0);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();

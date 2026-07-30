/**
 * Tier Viewer — progression carousel for character pages.
 *
 * Provides prev/next navigation and dot indicators to cycle through
 * character tiers (Fledgling, Sworn, Radiant, Mythic).
 *
 * Features:
 * - Click arrows or dots to switch tiers
 * - Keyboard: left/right arrow keys when focused
 * - Smooth crossfade transition between tier images
 * - Updates tier title with capitalized tier name
 * - Wraps around at boundaries
 */

(function () {
  'use strict';

  var TIER_ORDER = ['fledgling', 'sworn', 'radiant', 'mythic'];

  function initViewer(container) {
    var images = container.querySelectorAll('[data-tier]');
    var dots = container.querySelectorAll('[data-tier-dot]');
    var titleEl = container.querySelector('[data-tier-title]');
    var prevBtn = container.querySelector('[data-tier-prev]');
    var nextBtn = container.querySelector('[data-tier-next]');

    // Build ordered list of available tiers
    var availableTiers = [];
    images.forEach(function (img) {
      var tier = img.getAttribute('data-tier');
      if (tier && TIER_ORDER.indexOf(tier) !== -1) {
        availableTiers.push(tier);
      }
    });

    // Sort by canonical order
    availableTiers.sort(function (a, b) {
      return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
    });

    if (availableTiers.length < 2) return;

    var currentIndex = 0;

    function capitalize(str) {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function showTier(index) {
      currentIndex = index;
      var tier = availableTiers[currentIndex];

      // Update images
      images.forEach(function (img) {
        if (img.getAttribute('data-tier') === tier) {
          img.classList.add('wiki-tier-viewer__img--active');
        } else {
          img.classList.remove('wiki-tier-viewer__img--active');
        }
      });

      // Update dots
      dots.forEach(function (dot) {
        if (dot.getAttribute('data-tier-dot') === tier) {
          dot.classList.add('wiki-tier-viewer__dot--active');
          dot.setAttribute('aria-selected', 'true');
        } else {
          dot.classList.remove('wiki-tier-viewer__dot--active');
          dot.setAttribute('aria-selected', 'false');
        }
      });

      // Update title
      if (titleEl) {
        titleEl.textContent = capitalize(tier);
      }
    }

    function next() {
      var idx = (currentIndex + 1) % availableTiers.length;
      showTier(idx);
    }

    function prev() {
      var idx = (currentIndex - 1 + availableTiers.length) % availableTiers.length;
      showTier(idx);
    }

    // Arrow buttons
    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (nextBtn) nextBtn.addEventListener('click', next);

    // Dot buttons
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var tier = dot.getAttribute('data-tier-dot');
        var idx = availableTiers.indexOf(tier);
        if (idx !== -1) showTier(idx);
      });
    });

    // Keyboard navigation when viewer is focused
    container.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        prev();
      }
    });

    // Make container focusable for keyboard nav
    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '0');
    }
  }

  // Initialize all tier viewers on the page
  function init() {
    var viewers = document.querySelectorAll('[data-tier-viewer]');
    viewers.forEach(initViewer);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();

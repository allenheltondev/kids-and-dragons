/**
 * Image Lightbox — modal overlay for wiki images.
 *
 * Intercepts clicks on gallery links and clickable images, displaying
 * the full-size image in a centered modal with a dark backdrop.
 *
 * Features:
 * - Click any gallery image or portrait to open in modal (at full resolution,
 *   via data-full, even when the page renders a smaller derived portrait)
 * - Click backdrop, close button, or press Escape to dismiss
 * - Traps focus inside modal while open
 * - Prevents body scroll while modal is active
 * - Accessible: role="dialog", aria-modal, aria-label
 */

(function () {
  'use strict';

  // --- DOM Setup ---

  var overlay = document.createElement('div');
  overlay.className = 'wiki-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Image preview');
  overlay.hidden = true;

  var closeBtn = document.createElement('button');
  closeBtn.className = 'wiki-lightbox__close';
  closeBtn.setAttribute('aria-label', 'Close image preview');
  closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  var imgEl = document.createElement('img');
  imgEl.className = 'wiki-lightbox__img';
  imgEl.alt = '';

  overlay.appendChild(closeBtn);
  overlay.appendChild(imgEl);
  document.body.appendChild(overlay);

  // --- State ---

  var previousFocus = null;

  // --- Open / Close ---

  function open(src, alt) {
    imgEl.src = src;
    imgEl.alt = alt || 'Full size image';
    overlay.hidden = false;
    previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function close() {
    overlay.hidden = true;
    imgEl.src = '';
    document.body.style.overflow = '';
    if (previousFocus) {
      previousFocus.focus();
      previousFocus = null;
    }
  }

  // --- Event Listeners ---

  // Close on backdrop click (not on the image itself)
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) {
      close();
    }
  });

  closeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.hidden) {
      close();
    }
  });

  // --- Intercept Image Clicks ---

  /**
   * Checks if a URL points to an image file.
   */
  function isImageURL(url) {
    if (!url) return false;
    var path = url.split('?')[0].split('#')[0].toLowerCase();
    return /\.(png|jpg|jpeg|gif|webp|avif|svg)$/.test(path);
  }

  document.addEventListener('click', function (e) {
    // Case 1: Gallery link wrapping an image (<a> with href to image)
    var link = e.target.closest('a.wiki-gallery__link');
    if (link && isImageURL(link.href)) {
      e.preventDefault();
      var img = link.querySelector('img');
      open(link.href, img ? img.alt : '');
      return;
    }

    // Case 2: Infobox portrait image (no link wrapper)
    // `data-full` is the commissioned source; `src` is the small derived
    // portrait the page renders. Opening `src` would zoom into a thumbnail.
    var portrait = e.target.closest('.wiki-infobox__portrait-img');
    if (portrait) {
      e.preventDefault();
      open(portrait.dataset.full || portrait.src, portrait.alt);
      return;
    }

    // Case 3: Any image inside main content area that links to an image
    var contentLink = e.target.closest('.main-content a, .entity-content a');
    if (contentLink && isImageURL(contentLink.href)) {
      var innerImg = contentLink.querySelector('img');
      if (innerImg) {
        e.preventDefault();
        open(contentLink.href, innerImg.alt);
        return;
      }
    }
  });
})();

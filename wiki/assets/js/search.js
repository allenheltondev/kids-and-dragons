/**
 * Pagefind navbar search with type-ahead dropdown.
 *
 * Initializes search in both desktop (#navbar-search-container) and
 * mobile (#search-overlay-container) containers.
 *
 * Features:
 * - Debounced search (150ms) triggering after 2+ characters
 * - Displays up to 5 results: entity title, type badge, excerpt (max 120 chars)
 * - Arrow-key navigation with visual focus indicator
 * - Enter navigates to focused result, Escape closes dropdown
 * - "No results found" message for zero-match queries
 */

// --- Configuration ---
var MAX_RESULTS = 5;
var MIN_QUERY_LENGTH = 2;
var DEBOUNCE_MS = 150;
var MAX_EXCERPT_CHARS = 120;

// --- Exported utility for testability ---

/**
 * Truncate text at word boundaries, appending "…" if truncated.
 * Total output length (including ellipsis) will not exceed maxLength.
 *
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum output length
 * @returns {string} Truncated text
 */
export function truncateExcerpt(text, maxLength) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return '';
  if (maxLength === 1) return '\u2026';

  // Reserve space for the ellipsis character
  var limit = maxLength - 1;
  var truncated = text.slice(0, limit);

  // Try to break at a word boundary (last space within the truncated portion)
  var lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    truncated = truncated.slice(0, lastSpace);
  }

  return truncated + '\u2026';
}

// Expose on window for browser usage
if (typeof window !== 'undefined') {
  window.truncateExcerpt = truncateExcerpt;
}

// --- Pagefind Loading ---

var pagefind = null;

function loadPagefind() {
  if (pagefind) return Promise.resolve(pagefind);
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));

  return import('/pagefind/pagefind.js')
    .then(function (pf) {
      pagefind = pf;
      if (pagefind.init) {
        return pagefind.init();
      }
      return pagefind;
    })
    .then(function () {
      return pagefind;
    })
    .catch(function (err) {
      console.warn('[search] Failed to load Pagefind:', err);
      return null;
    });
}

// --- Debounce helper ---

function debounce(fn, delay) {
  var timer = null;
  return function () {
    var context = this;
    var args = arguments;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(context, args);
    }, delay);
  };
}

// --- Search Instance ---

/**
 * Creates a search UI instance for a given container.
 * @param {HTMLElement} container - The DOM element to render search into
 */
function createSearchInstance(container) {
  if (!container) return;

  // Build DOM structure
  var wrapper = document.createElement('div');
  wrapper.className = 'wiki-search';
  wrapper.setAttribute('role', 'combobox');
  wrapper.setAttribute('aria-expanded', 'false');
  wrapper.setAttribute('aria-haspopup', 'listbox');

  var input = document.createElement('input');
  input.type = 'search';
  input.className = 'wiki-search__input';
  input.placeholder = 'Search the wiki\u2026';
  input.setAttribute('aria-label', 'Search the wiki');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'wiki-search-results-' + container.id);
  input.autocomplete = 'off';

  var dropdown = document.createElement('div');
  dropdown.className = 'wiki-search__dropdown';
  dropdown.id = 'wiki-search-results-' + container.id;
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Search results');
  dropdown.hidden = true;

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);
  container.appendChild(wrapper);

  // State
  var activeIndex = -1;
  var results = [];

  // --- Search execution ---

  function performSearch(query) {
    if (!query || query.length < MIN_QUERY_LENGTH) {
      closeDropdown();
      return;
    }

    loadPagefind().then(function (pf) {
      if (!pf) return;

      pf.search(query).then(function (search) {
        if (!search || !search.results) {
          showNoResults();
          return;
        }

        var sliced = search.results.slice(0, MAX_RESULTS);
        if (sliced.length === 0) {
          showNoResults();
          return;
        }

        // Load result data
        Promise.all(
          sliced.map(function (r) {
            return r.data();
          })
        ).then(function (loaded) {
          results = loaded;
          renderResults(loaded);
        });
      });
    });
  }

  var debouncedSearch = debounce(performSearch, DEBOUNCE_MS);

  // --- Rendering ---

  function renderResults(items) {
    dropdown.innerHTML = '';
    activeIndex = -1;

    items.forEach(function (item, index) {
      var option = document.createElement('a');
      option.className = 'wiki-search__result';
      option.href = item.url || '#';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.id = dropdown.id + '-item-' + index;

      // Title
      var title = document.createElement('span');
      title.className = 'wiki-search__result-title';
      title.textContent = item.meta && item.meta.title ? item.meta.title : 'Untitled';
      option.appendChild(title);

      // Type badge (from meta.type or inferred from URL)
      var type = getEntityType(item);
      if (type) {
        var badge = document.createElement('span');
        badge.className = 'wiki-search__result-badge';
        badge.textContent = type;
        option.appendChild(badge);
      }

      // Excerpt
      var excerptText = item.excerpt || '';
      // Strip Pagefind highlight marks for plain text truncation
      excerptText = excerptText.replace(/<\/?mark>/g, '');
      excerptText = truncateExcerpt(excerptText, MAX_EXCERPT_CHARS);

      if (excerptText) {
        var excerpt = document.createElement('span');
        excerpt.className = 'wiki-search__result-excerpt';
        excerpt.textContent = excerptText;
        option.appendChild(excerpt);
      }

      option.addEventListener('mouseenter', function () {
        setActiveIndex(index);
      });

      dropdown.appendChild(option);
    });

    openDropdown();
  }

  function showNoResults() {
    dropdown.innerHTML = '';
    results = [];
    activeIndex = -1;

    var msg = document.createElement('div');
    msg.className = 'wiki-search__no-results';
    msg.setAttribute('role', 'option');
    msg.textContent = 'No results found';
    dropdown.appendChild(msg);

    openDropdown();
  }

  function openDropdown() {
    dropdown.hidden = false;
    wrapper.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    dropdown.hidden = true;
    wrapper.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
    results = [];
    dropdown.innerHTML = '';
    input.removeAttribute('aria-activedescendant');
  }

  // --- Keyboard navigation ---

  function setActiveIndex(index) {
    // Remove previous highlight
    var items = dropdown.querySelectorAll('.wiki-search__result');
    items.forEach(function (el) {
      el.classList.remove('wiki-search__result--focused');
      el.setAttribute('aria-selected', 'false');
    });

    activeIndex = index;

    if (index >= 0 && index < items.length) {
      items[index].classList.add('wiki-search__result--focused');
      items[index].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', items[index].id);
      // Ensure visible (scroll into view if needed)
      items[index].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function navigateToResult(index) {
    var items = dropdown.querySelectorAll('.wiki-search__result');
    if (index >= 0 && index < items.length && items[index].href) {
      window.location.href = items[index].href;
    }
  }

  // --- Event listeners ---

  input.addEventListener('input', function () {
    var query = input.value.trim();
    debouncedSearch(query);
  });

  input.addEventListener('keydown', function (e) {
    var items = dropdown.querySelectorAll('.wiki-search__result');
    var count = items.length;

    if (dropdown.hidden || count === 0) {
      if (e.key === 'Escape') {
        input.blur();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(activeIndex < count - 1 ? activeIndex + 1 : 0);
        break;

      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(activeIndex > 0 ? activeIndex - 1 : count - 1);
        break;

      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) {
          navigateToResult(activeIndex);
        }
        break;

      case 'Escape':
        e.preventDefault();
        closeDropdown();
        input.focus();
        break;
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (!wrapper.contains(e.target)) {
      closeDropdown();
    }
  });

  // Close dropdown on focus loss
  input.addEventListener('blur', function () {
    // Delay to allow click on result to register
    setTimeout(function () {
      if (!wrapper.contains(document.activeElement)) {
        closeDropdown();
      }
    }, 150);
  });

  return { input: input, wrapper: wrapper, closeDropdown: closeDropdown };
}

// --- Helpers ---

/**
 * Extract entity type from Pagefind result metadata or URL.
 */
function getEntityType(item) {
  // Check meta.type first (if Pagefind data attributes set it)
  if (item.meta && item.meta.type) {
    return item.meta.type;
  }
  // Infer from URL path segments
  if (item.url) {
    var segments = item.url.replace(/^\//, '').split('/');
    if (segments.length >= 2) {
      var section = segments[0];
      // Singularize common section names for badge display
      if (section === 'creatures') return 'creature';
      if (section === 'characters') return 'character';
      if (section === 'biomes') return 'biome';
      if (section === 'npcs') return 'npc';
      if (section === 'items') return 'item';
      if (section === 'locations') return 'location';
      if (section === 'quests') return 'quest';
      if (section === 'factions') return 'faction';
      return section;
    }
  }
  return '';
}

// --- Mobile Search Overlay Toggle ---

/**
 * Initializes the mobile search overlay toggle behavior.
 * - Search icon button toggles full-width search overlay (visible < 768px)
 * - Dismiss overlay on Escape, close button click, or tap outside
 * - Lock body scroll while overlay is open
 * - Set aria-expanded on toggle button
 * - Focus mobile search input when overlay opens
 */
function initMobileSearchOverlay() {
  var toggleBtn = document.getElementById('search-toggle');
  var overlay = document.getElementById('search-overlay');

  if (!toggleBtn || !overlay) return;

  function openOverlay() {
    overlay.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    // Focus the mobile search input when overlay opens
    var mobileInput = overlay.querySelector('.wiki-search__input');
    if (mobileInput) {
      // Small delay to allow overlay to render
      setTimeout(function () {
        mobileInput.focus();
      }, 50);
    }
  }

  function closeOverlay() {
    overlay.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function isOverlayOpen() {
    return !overlay.hidden;
  }

  // Toggle on search icon button click
  toggleBtn.addEventListener('click', function () {
    if (isOverlayOpen()) {
      closeOverlay();
    } else {
      openOverlay();
    }
  });

  // Dismiss on Escape key (only if the search dropdown is not open)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOverlayOpen()) {
      // Don't close overlay if a search dropdown is currently visible;
      // let the dropdown close first (handled by the input keydown handler)
      var dropdown = overlay.querySelector('.wiki-search__dropdown');
      if (dropdown && !dropdown.hidden) {
        return;
      }
      closeOverlay();
      toggleBtn.focus();
    }
  });

  // Dismiss on tap/click outside the overlay content
  overlay.addEventListener('click', function (e) {
    // Close only if clicking on the overlay backdrop itself, not its children
    if (e.target === overlay) {
      closeOverlay();
    }
  });

  // Dismiss on close button click (if one exists inside the overlay)
  var closeBtn = overlay.querySelector('[data-search-close]');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closeOverlay();
      toggleBtn.focus();
    });
  }
}

// --- Initialize on DOM ready (browser only) ---

function init() {
  var desktopContainer = document.getElementById('navbar-search-container');
  var mobileContainer = document.getElementById('search-overlay-container');

  createSearchInstance(desktopContainer);
  createSearchInstance(mobileContainer);

  // Initialize mobile search overlay toggle
  initMobileSearchOverlay();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

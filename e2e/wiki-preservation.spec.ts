/**
 * Wiki UX Preservation Property Tests
 *
 * These tests capture baseline behaviors on UNFIXED code that must remain
 * unchanged after the bugfix is applied. They verify preservation properties
 * for components not affected by the eight bug conditions.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 */
import { test, expect } from '@playwright/test';

/**
 * Serve the wiki from the pre-built public directory.
 * Tests use a static file server on the built Hugo output.
 */
test.use({
  baseURL: 'http://localhost:4173',
});

/**
 * Property 2.1: Desktop Sidebar Preservation
 * For all desktop viewports (≥ 768px): sidebar width remains 260px with sticky positioning
 *
 * **Validates: Requirements 3.1**
 */
test.describe('Preservation: Desktop Sidebar (Req 3.1)', () => {
  const desktopViewports = [
    { width: 768, height: 800 },
    { width: 1024, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  for (const viewport of desktopViewports) {
    test(`sidebar renders at 260px CSS width with sticky positioning at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/creatures/ember_wraith/');
      await page.waitForLoadState('domcontentloaded');

      const sidebar = page.locator('#wiki-sidebar');
      await expect(sidebar).toBeVisible();

      // Verify CSS width property is 260px (content-box model: rendered box
      // includes padding so boundingBox is larger, but the CSS width stays 260px)
      const cssWidth = await sidebar.evaluate((el) => {
        return window.getComputedStyle(el).width;
      });
      expect(cssWidth).toBe('260px');

      // Verify sticky positioning via computed style
      const position = await sidebar.evaluate((el) => {
        return window.getComputedStyle(el).position;
      });
      expect(position).toBe('sticky');
    });
  }

  test('sidebar contains section navigation links', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    const sectionLinks = page.locator('.wiki-sidebar__section-link');
    const count = await sectionLinks.count();
    // Should have multiple section navigation links
    expect(count).toBeGreaterThan(3);

    // Verify links point to section pages
    const firstLink = sectionLinks.first();
    const href = await firstLink.getAttribute('href');
    expect(href).toBeTruthy();
  });
});

/**
 * Property 2.2: Biome Hero Image Preservation
 * For all biome pages: the hero image area renders when assets.primary is present
 *
 * Note: In the current build, biomes don't have assets.primary set in frontmatter,
 * so the hero image div is not rendered. The preservation property verifies the
 * biome single layout structure remains intact (entity-layout, infobox-biome).
 *
 * **Validates: Requirements 3.2**
 */
test.describe('Preservation: Biome Page Structure (Req 3.2)', () => {
  const biomePages = [
    '/biomes/enchanted_woods/',
    '/biomes/crimson_highlands/',
    '/biomes/frostfang_peaks/',
  ];

  for (const biomePath of biomePages) {
    test(`biome page ${biomePath} maintains layout structure`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(biomePath);
      await page.waitForLoadState('domcontentloaded');

      // Biome pages should have the entity-type-biome class
      const article = page.locator('article.entity-type-biome');
      await expect(article).toBeVisible();

      // Biome infobox should render with biome information
      const infobox = page.locator('.wiki-infobox--biome');
      await expect(infobox).toBeVisible();

      // Infobox should have a title
      const infoboxTitle = page.locator('.wiki-infobox__title');
      await expect(infoboxTitle).toBeVisible();
    });
  }
});

/**
 * Property 2.3: Tier Viewer Carousel Preservation
 * For character pages with ≥ 2 tiers: carousel controls (arrows, dots) are present
 *
 * Note: In the current build, characters don't have assets defined in frontmatter,
 * so the tier viewer doesn't render. We verify the character page layout structure
 * remains intact. When assets ARE present (post wiki:generate), the tier viewer
 * template logic is preserved.
 *
 * **Validates: Requirements 3.3**
 */
test.describe('Preservation: Character Page Structure (Req 3.3)', () => {
  const characterPages = [
    '/characters/bigfoot/',
    '/characters/dragonling/',
    '/characters/griffin/',
  ];

  for (const charPath of characterPages) {
    test(`character page ${charPath} maintains layout structure`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(charPath);
      await page.waitForLoadState('domcontentloaded');

      // Character pages should have entity-type-character class
      const article = page.locator('article.entity-type-character');
      await expect(article).toBeVisible();

      // Character page should have entity-layout structure
      const layout = page.locator('.entity-layout--with-infobox');
      await expect(layout).toBeVisible();

      // Entity content area should be present
      const content = page.locator('.entity-content');
      await expect(content).toBeVisible();

      // Page title should render
      const h1 = content.locator('h1');
      await expect(h1).toBeVisible();
    });
  }
});

/**
 * Property 2.4: Entity Page Components Preservation
 * For all entity pages: breadcrumb navigation renders correctly
 *
 * **Validates: Requirements 3.4**
 */
test.describe('Preservation: Entity Page Components (Req 3.4)', () => {
  const entityPages = [
    '/creatures/ember_wraith/',
    '/biomes/enchanted_woods/',
    '/characters/bigfoot/',
  ];

  for (const entityPath of entityPages) {
    test(`entity page ${entityPath} renders breadcrumb navigation`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(entityPath);
      await page.waitForLoadState('domcontentloaded');

      // Breadcrumb should render
      const breadcrumb = page.locator('.wiki-breadcrumb');
      await expect(breadcrumb).toBeVisible();

      // Should have breadcrumb items (Home > Section > Page)
      const items = page.locator('.wiki-breadcrumb__item');
      const count = await items.count();
      expect(count).toBeGreaterThanOrEqual(2);

      // First item should link to home
      const homeLink = page.locator('.wiki-breadcrumb__link').first();
      await expect(homeLink).toBeVisible();

      // Current page should be marked
      const currentItem = page.locator('.wiki-breadcrumb__item--current');
      await expect(currentItem).toBeVisible();
    });
  }

  test('creature infobox renders with data fields', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    // Creature infobox should be present
    const infobox = page.locator('.wiki-infobox--creature');
    await expect(infobox).toBeVisible();

    // Should have infobox title
    const title = page.locator('.wiki-infobox__title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Ember Wraith');
  });
});

/**
 * Property 2.5: Mobile Search Overlay Preservation
 * For mobile viewport: search overlay structure exists and toggle is functional
 *
 * **Validates: Requirements 3.5**
 */
test.describe('Preservation: Mobile Search Overlay (Req 3.5)', () => {
  test('search toggle button is visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    // Search toggle button should be visible on mobile
    const searchToggle = page.locator('#search-toggle');
    await expect(searchToggle).toBeVisible();

    // The search overlay element should exist in the DOM
    const searchOverlay = page.locator('#search-overlay');
    await expect(searchOverlay).toBeAttached();
  });

  test('search toggle button is hidden on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    // Search toggle should be hidden on desktop
    const searchToggle = page.locator('#search-toggle');
    await expect(searchToggle).toBeHidden();

    // Desktop inline search should be visible
    const inlineSearch = page.locator('#navbar-search');
    await expect(inlineSearch).toBeVisible();
  });
});

/**
 * Property 2.6: Theme Toggle Persistence Preservation
 * For all viewports: theme toggle persists preference to localStorage
 *
 * **Validates: Requirements 3.6**
 */
test.describe('Preservation: Theme Toggle (Req 3.6)', () => {
  test('theme toggle button is present and functional', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    // Theme toggle button should exist
    const themeToggle = page.locator('#theme-toggle');
    await expect(themeToggle).toBeVisible();

    // Observe initial state (Playwright defaults to prefers-color-scheme: light,
    // so with no localStorage entry, the theme-head script removes 'dark' class)
    const isDarkBefore = await page.locator('html').evaluate((el) => {
      return el.classList.contains('dark');
    });

    // Click toggle to switch theme
    await themeToggle.click();

    // Theme should have toggled
    const isDarkAfter = await page.locator('html').evaluate((el) => {
      return el.classList.contains('dark');
    });
    expect(isDarkAfter).not.toBe(isDarkBefore);

    // Should persist to localStorage
    const storedTheme = await page.evaluate(() => {
      return localStorage.getItem('wiki-theme');
    });
    expect(storedTheme).toBe(isDarkAfter ? 'dark' : 'light');
  });

  test('theme persists across page navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    // Toggle to dark mode explicitly
    const themeToggle = page.locator('#theme-toggle');
    await themeToggle.click();

    // Verify the toggle persisted
    const storedTheme = await page.evaluate(() => {
      return localStorage.getItem('wiki-theme');
    });

    // Navigate to another page
    await page.goto('/biomes/enchanted_woods/');
    await page.waitForLoadState('domcontentloaded');

    // Should maintain the same theme (persisted via localStorage)
    const isDarkAfterNav = await page.locator('html').evaluate((el) => {
      return el.classList.contains('dark');
    });
    // The stored theme determines the state after navigation
    expect(isDarkAfterNav).toBe(storedTheme === 'dark');
  });

  test('theme toggle works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    const themeToggle = page.locator('#theme-toggle');
    await expect(themeToggle).toBeVisible();

    // Toggle and verify persistence
    await themeToggle.click();
    const storedTheme = await page.evaluate(() => {
      return localStorage.getItem('wiki-theme');
    });
    // Should have persisted some theme value
    expect(storedTheme).toMatch(/^(dark|light)$/);
  });
});

/**
 * Property 2.7: Tile Card Hover Animations Preservation
 * For desktop: tile cards have hover animation CSS properties defined
 *
 * **Validates: Requirements 3.7**
 */
test.describe('Preservation: Tile Card Hover Animations (Req 3.7)', () => {
  test('tile cards have transition properties for hover animation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Use a section that HAS tile cards (routes, locations, geography)
    await page.goto('/routes/');
    await page.waitForLoadState('domcontentloaded');

    const tileCard = page.locator('.wiki-tile-card').first();
    await expect(tileCard).toBeVisible();

    // Verify transition CSS is set (enables hover animations)
    const transition = await tileCard.evaluate((el) => {
      return window.getComputedStyle(el).transition;
    });
    // Should have transition properties for border-color, box-shadow, transform
    expect(transition).toContain('border-color');
    expect(transition).toContain('box-shadow');
    expect(transition).toContain('transform');
  });

  test('tile cards apply hover styles on mouse interaction', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/routes/');
    await page.waitForLoadState('domcontentloaded');

    const tileCard = page.locator('.wiki-tile-card').first();
    await expect(tileCard).toBeVisible();

    // Get transform before hover
    const transformBefore = await tileCard.evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });

    // Hover over the card
    await tileCard.hover();

    // Wait for transition
    await page.waitForTimeout(250);

    // Get transform after hover — should have translateY applied
    const transformAfter = await tileCard.evaluate((el) => {
      return window.getComputedStyle(el).transform;
    });

    // Transform should change (translateY(-2px) becomes a matrix)
    // Before hover: none or matrix(1, 0, 0, 1, 0, 0)
    // After hover: matrix(1, 0, 0, 1, 0, -2)
    expect(transformAfter).not.toBe(transformBefore);
  });
});

/**
 * Property 2.8: Non-Biome Infobox Preservation
 * For creature/NPC/item/quest pages: infobox renders with entity data
 *
 * Note: Currently portraits don't render because assets.primary isn't populated
 * in frontmatter. The preservation property verifies the infobox structure and
 * data fields remain intact.
 *
 * **Validates: Requirements 3.8**
 */
test.describe('Preservation: Non-Biome Entity Infoboxes (Req 3.8)', () => {
  const creaturePages = [
    { path: '/creatures/ember_wraith/', name: 'Ember Wraith' },
    { path: '/creatures/frost_wyrm/', name: 'Frost Wyrm' },
    { path: '/creatures/jackalope/', name: 'Jackalope' },
  ];

  for (const { path: pagePath, name } of creaturePages) {
    test(`creature infobox renders correctly for ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(pagePath);
      await page.waitForLoadState('domcontentloaded');

      // Creature infobox should be present with proper class
      const infobox = page.locator('.wiki-infobox--creature');
      await expect(infobox).toBeVisible();

      // Should have title
      const title = page.locator('.wiki-infobox__title');
      await expect(title).toBeVisible();
      await expect(title).toContainText(name);

      // Should have the fields container (dl element), though individual
      // fields may or may not be populated depending on the creature's data
      const fieldsContainer = page.locator('.wiki-infobox__fields');
      await expect(fieldsContainer).toBeAttached();
    });
  }

  test('biome infobox renders with biome-specific data', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/biomes/enchanted_woods/');
    await page.waitForLoadState('domcontentloaded');

    // Biome infobox renders differently (no portrait in current state)
    const infobox = page.locator('.wiki-infobox--biome');
    await expect(infobox).toBeVisible();

    const title = page.locator('.wiki-infobox__title');
    await expect(title).toContainText('Enchanted Woods');
  });
});

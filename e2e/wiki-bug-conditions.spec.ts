/**
 * Wiki UX Bug Condition Exploration Tests
 *
 * These tests encode the EXPECTED (correct) behavior for 8 UI/UX regressions.
 * They are expected to FAIL on unfixed code — failure confirms the bugs exist.
 * When the fixes are applied, these tests should PASS.
 *
 * For bugs that only manifest when specific content data is present (assets.primary),
 * we test the underlying template/CSS structure that causes the bug.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8**
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({
  baseURL: 'http://localhost:4173',
});

/**
 * Bug 1: Mobile Navbar Overflow
 * WHEN the site is viewed on a mobile viewport (< 768px)
 * THEN navbar title should have overflow:hidden and flex-shrink > 0
 * so it truncates instead of pushing other elements off-screen.
 *
 * Root cause: .wiki-navbar__title has flex-shrink:0 and white-space:nowrap
 * with no overflow:hidden, causing the title to push controls off viewport.
 *
 * **Validates: Requirements 1.1**
 */
test.describe('Bug 1: Mobile Navbar Overflow (Req 1.1)', () => {
  test('navbar title has overflow hidden on mobile for text truncation', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    const title = page.locator('.wiki-navbar__title');
    await expect(title).toBeVisible();

    // The title should have overflow: hidden for text truncation on mobile
    const overflow = await title.evaluate((el) => {
      return window.getComputedStyle(el).overflow;
    });
    // Expected: "hidden" so long titles truncate with ellipsis
    // Bug: Currently "visible" — title extends beyond available space
    expect(overflow).toBe('hidden');
  });
});

/**
 * Bug 2: Desktop Content Max-Width Constraint
 * WHEN the site is viewed on desktop (≥ 768px)
 * THEN the main content area should NOT be constrained by max-width: 900px.
 *
 * **Validates: Requirements 1.2**
 */
test.describe('Bug 2: Desktop Content Width (Req 1.2)', () => {
  test('main-content does not have max-width: 900px on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    const mainContent = page.locator('.main-content');
    await expect(mainContent).toBeVisible();

    // The computed max-width should NOT be 900px
    const maxWidth = await mainContent.evaluate((el) => {
      return window.getComputedStyle(el).maxWidth;
    });
    // Bug: Currently "900px". Expected: "none" after fix.
    expect(maxWidth).not.toBe('900px');
  });
});

/**
 * Bug 3: Biome Hero Image Duplication (Template Structural Test)
 * WHEN a biome entity page is rendered and assets.primary is present
 * THEN the hero image should appear only once (not also in the infobox).
 *
 * We test this by verifying the biome infobox template source does NOT
 * contain a portrait image block. The template should be clean of this code.
 *
 * **Validates: Requirements 1.3**
 */
test.describe('Bug 3: Biome Infobox Portrait Duplication (Req 1.3)', () => {
  test('biome infobox template does not render portrait image', async () => {
    // Read the biome infobox template source
    const templatePath = path.resolve('wiki/layouts/partials/infobox/biome.html');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');

    // The template should NOT have the assets.primary portrait rendering block
    // Bug: Currently contains `{{ with .Params.assets.primary }}` portrait block
    // Expected: This block should be removed so biomes don't duplicate the hero image
    expect(templateContent).not.toContain('.Params.assets.primary');
  });
});

/**
 * Bug 4: Character Portrait and Gallery Duplication (Template Structural Test)
 * WHEN a character entity page is rendered
 * THEN no infobox portrait AND no gallery section should be rendered.
 * The tier viewer serves as the primary visual representation.
 *
 * We test by verifying the character template does NOT call the gallery partial.
 *
 * **Validates: Requirements 1.4**
 */
test.describe('Bug 4: Character Portrait/Gallery Duplication (Req 1.4)', () => {
  test('character single template does not include gallery partial', async () => {
    // Read the character single template
    const templatePath = path.resolve('wiki/layouts/characters/single.html');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');

    // The template should NOT call the gallery partial
    // Bug: Currently contains {{ partial "gallery.html" $ }}
    // Expected: Gallery removed since tier viewer is the sole image display
    expect(templateContent).not.toContain('gallery.html');
  });

  test('character single template does not render infobox portrait', async () => {
    // Read the character single template
    const templatePath = path.resolve('wiki/layouts/characters/single.html');
    const templateContent = fs.readFileSync(templatePath, 'utf-8');

    // The template should NOT have an infobox portrait block using assets.primary
    // Bug: Currently renders a portrait image from .Params.assets.primary
    // Expected: Removed — tier viewer shows the character images
    expect(templateContent).not.toContain('wiki-infobox__portrait');
  });
});

/**
 * Bug 5: Horizontal Scrollbar on Mobile
 * WHEN the site is viewed on mobile
 * THEN scrollWidth should not exceed viewport width.
 *
 * **Validates: Requirements 1.5**
 */
test.describe('Bug 5: Horizontal Overflow on Mobile (Req 1.5)', () => {
  test('no horizontal scrollbar at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/creatures/ember_wraith/');
    await page.waitForLoadState('domcontentloaded');

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    // Expected: no horizontal overflow
    expect(hasOverflow).toBe(false);
  });
});

/**
 * Bug 6: Navbar Title Link Points to Wrong Path
 * WHEN the user clicks the navbar title
 * THEN it should navigate to the site base URL containing "/kids-and-dragons/".
 *
 * The Hugo template uses `{{ "/" | relURL }}` which produces "/" instead of
 * the configured baseURL path "/kids-and-dragons/".
 *
 * **Validates: Requirements 1.6**
 */
test.describe('Bug 6: Navbar Title Link (Req 1.6)', () => {
  test('navbar title link href is not just "/"', async ({ page }) => {
    await page.goto('/biomes/crimson_highlands/');
    await page.waitForLoadState('domcontentloaded');

    const titleLink = page.locator('.wiki-navbar__title');
    const href = await titleLink.getAttribute('href');

    // The href should NOT be just "/" — it should reference the site base path.
    // Bug: relURL("/") produces "/" regardless of baseURL config.
    // Expected: Should use absURL or .Site.BaseURL to get "/kids-and-dragons/"
    expect(href).not.toBe('/');
  });
});

/**
 * Bug 7: Section List Pages Show No Tile Cards
 * WHEN the /biomes/ list page is viewed
 * THEN tile cards should be displayed for all biome content pages.
 *
 * **Validates: Requirements 1.7**
 */
test.describe('Bug 7: Section List Pages Empty (Req 1.7)', () => {
  test('biomes list page displays tile cards', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/biomes/');
    await page.waitForLoadState('domcontentloaded');

    const tileCards = page.locator('.wiki-tile-card');
    const count = await tileCards.count();
    // Expected: tile cards > 0 (biomes section has 18+ pages)
    expect(count).toBeGreaterThan(0);
  });
});

/**
 * Bug 8: Relationship Chips Overlap on Mobile (CSS Structural Test)
 * WHEN entity page with relationship chips is viewed at 375px
 * THEN chips should stack vertically and not overlap adjacent images.
 *
 * The root cause is CSS lacks mobile-specific wrapping rules for
 * `.entity-content li` items containing code chips. The fix adds
 * display:flex; flex-wrap:wrap in the mobile media query.
 *
 * We verify the CSS source has the mobile rule for entity-content li.
 *
 * **Validates: Requirements 1.8**
 */
test.describe('Bug 8: Relationship Chips Mobile Overlap (Req 1.8)', () => {
  test('CSS has mobile flex-wrap rule for entity-content list items', async () => {
    // Read the CSS source file
    const cssPath = path.resolve('wiki/assets/css/custom.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Extract the mobile media query section (max-width: 767px)
    // and check if it contains a flex rule for .entity-content li
    const mobileMediaRegex = /@media\s*\(\s*max-width:\s*767px\s*\)\s*\{([\s\S]*?)\n\}/g;
    let mobileRules = '';
    let match;
    while ((match = mobileMediaRegex.exec(cssContent)) !== null) {
      mobileRules += match[1];
    }

    // Expected: CSS should have a rule for .entity-content li with flex-wrap on mobile
    // Bug: No mobile wrapping rules exist for entity-content list items
    expect(mobileRules).toContain('.entity-content li');
  });
});

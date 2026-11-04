import { test, expect } from "@playwright/test";
import { seedTable, openTv, onAir } from "./seed";

test("TV lobby keeps its crew in the corner row and joining beside four heroes", async ({ browser }, info) => {
  const table = await seedTable({ mode: "party", tv: true, ready: false, heroes: [
    { name: "Thistlewhisker", species: "unicorn" }, { name: "Sparklehoof", species: "griffin" },
    { name: "Fern", species: "dragonling" }, { name: "Moss", species: "bigfoot" },
  ] });
  const { page, context } = await openTv(browser, table);
  try {
    await onAir(page);
    await expect(page.getByRole("button", { name: /^(Enable sound|Turn sound (on|off))$/ })).toHaveCount(1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(async () => {
      const modulePath = "/src/store/index.ts";
      const { useGameStore } = await import(modulePath);
      const state = useGameStore.getState().state;
      useGameStore.setState({ state: { ...state, location: "The kitchen table", crew: "otters", crews: [{ id: "otters", name: "The Moonlit Otter Crew" }] } });
    });
    /* Every TV size, at normal and the largest text, waiting and all ready (the heading says when
       everyone is), and a room open to visitors (a longer code). The normal text of a size comes
       before its largest, so the names' and portraits' size there can be held to it, and waiting
       comes before all ready, so nothing in the band can move between the two. */
    const sizes = [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 1024, height: 600 }];
    const viewports = sizes.flatMap(size => (["normal", "largest"] as const).flatMap(text => [false, true].map(ready => ({ ...size, text, ready, visitors: false }))));
    viewports.push({ width: 1280, height: 720, text: "normal", ready: true, visitors: true }, { width: 1280, height: 720, text: "largest", ready: false, visitors: true });
    const normalName = new Map<string, number>();
    const normalPortrait = new Map<string, number>();
    const waitingBoxes = new Map<string, Record<string, number[]>>();
    const report: string[] = [];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.evaluate(async ({ text, ready, visitors }) => {
        if (text === "normal") delete document.documentElement.dataset.text;
        else document.documentElement.dataset.text = text;
        const modulePath = "/src/store/index.ts";
        const { useGameStore } = await import(modulePath);
        const state = useGameStore.getState().state;
        useGameStore.setState({ state: { ...state, visitorCode: visitors ? "ABCDEF" : undefined, party: state.party.map(member => ({ ...member, ready })) } });
      }, viewport);
      await expect(page.getByRole("heading", { name: "Everyone in?" })).toHaveCount(0);
      await expect(page.locator(".lobby__qr:not(.lobby__qr--empty)")).toBeVisible();
      await expect(page.locator(".lobby-member")).toHaveCount(4);
      await expect(page.locator(".lobby__campaign--picked .lobby__campaign-selected")).toBeVisible();
      const brokenNames = await page.locator(".lobby-member__name").evaluateAll(names => names.filter(name => {
        const range = document.createRange();
        range.selectNodeContents(name);
        return range.getClientRects().length !== 1 || name.scrollWidth > name.clientWidth + 1;
      }).map(name => name.textContent));
      expect.soft(brokenNames, `${viewport.width}x${viewport.height} ${viewport.text}: hero names must remain whole and contained`).toEqual([]);
      await page.screenshot({ path: info.outputPath(`tv-${viewport.width}x${viewport.height}-${viewport.text}-${viewport.ready ? "ready" : "waiting"}${viewport.visitors ? "-visitors" : ""}.png`) });
      const layout = await page.evaluate(() => {
        const fonts = [...document.querySelectorAll<HTMLElement>(".lobby__heading > span:last-child, .lobby__header > .lobby__place > span:last-child, .lobby__header .crew-identity__name")].map(el => { const style = getComputedStyle(el); return [style.fontSize, style.fontFamily, style.fontWeight].join("|"); });
        const headerStyle = getComputedStyle(document.querySelector(".lobby__header")!);
        const header = document.querySelector(".lobby__header")!.getBoundingClientRect();
        const corner = document.querySelector(".kad-corner")!.getBoundingClientRect();
        const campWindow = document.querySelector(".lobby__camp-window")!.getBoundingClientRect();
        const crew = document.querySelector(".lobby__header .crew-identity")!.getBoundingClientRect();
        const table = document.querySelector(".lobby__header > .lobby__place")!.getBoundingClientRect();
        const join = document.querySelector(".lobby__join")!.getBoundingClientRect();
        const party = document.querySelector(".lobby__party")!.getBoundingClientRect();
        const campaigns = document.querySelector(".lobby__campaigns")!.getBoundingClientRect();
        const lobby = document.querySelector<HTMLElement>(".lobby")!;
        return {
          // The crew shares the corner row's strip, clear of its controls, and the camp's window starts under it.
          inCornerRow: header.top >= corner.top - 1 && header.bottom <= corner.bottom + 1,
          clearOfCorner: header.right < corner.left,
          windowUnderRow: campWindow.top < corner.bottom + 24,
          equalType: new Set(fonts).size === 1,
          noHeaderBackground: headerStyle.backgroundImage === "none" && headerStyle.backgroundColor === "rgba(0, 0, 0, 0)",
          crewInHeader: crew.top >= header.top && crew.bottom <= header.bottom,
          crewBesideTable: crew.left >= table.right,
          joinBesideParty: join.right < party.left,
          joinContainsCodeAndQr: [...document.querySelectorAll(".lobby__code-block, .lobby__qr-block")].every(el => {
            const box = el.getBoundingClientRect();
            return box.left >= join.left && box.right <= join.right && box.top >= join.top && box.bottom <= join.bottom;
          }),
          qrSquare: Math.abs(document.querySelector(".lobby__qr")!.getBoundingClientRect().width - document.querySelector(".lobby__qr")!.getBoundingClientRect().height) < 1,
          campaignsBelowParty: campaigns.top >= Math.max(join.bottom, ...[...document.querySelectorAll(".lobby-member")].map(el => el.getBoundingClientRect().bottom)),
          overflow: lobby.scrollHeight > lobby.clientHeight + 1,
          outside: [...document.querySelectorAll<HTMLElement>(".lobby__header, .lobby__campaign, .lobby__join, .lobby-member")].filter(el => {
            const box = el.getBoundingClientRect();
            return box.bottom > innerHeight + 1 || box.right > innerWidth + 1 || box.left < 0;
          }).map(el => el.className),
        };
      });
      // Every panel inside the pane, and what each panel holds inside it: the code's letters and
      // the QR in the Room panel, the heroes in the party's, and every adventure on the screen
      // whenever the room has more than one (four stacked cards once pushed them off it).
      const fit = await page.evaluate(async () => {
        const modulePath = "/src/store/index.ts";
        const { useGameStore } = await import(modulePath);
        const options: unknown[] = useGameStore.getState().state?.campaignOptions ?? [];
        const pane = document.querySelector(".lobby")!.getBoundingClientRect();
        const screen = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        const within = (box: DOMRect, outer: { left: number; top: number; right: number; bottom: number }) =>
          box.left >= outer.left - 1 && box.top >= outer.top - 1 && box.right <= outer.right + 1 && box.bottom <= outer.bottom + 1;
        const spills: string[] = [];
        const hold = (selector: string, parentSelector: string) => {
          for (const el of document.querySelectorAll<HTMLElement>(selector)) {
            const box = el.getBoundingClientRect();
            const parent = el.closest(parentSelector) ?? document.querySelector(parentSelector);
            if (!within(box, pane) || !within(box, screen)) spills.push(`${selector} outside the pane`);
            if (parent && parent !== el && !within(box, parent.getBoundingClientRect())) spills.push(`${selector} outside ${parentSelector}`);
          }
        };
        hold(".lobby__join", ".lobby");
        hold(".lobby__party", ".lobby");
        hold(".lobby__party-heading", ".lobby__party");
        hold(".lobby-member", ".lobby__party");
        hold(".lobby-member__name", ".lobby-member");
        hold(".lobby-member__portrait", ".lobby-member");
        hold(".lobby-member__status .kad-chip", ".lobby-member");
        hold(".lobby__code-letter", ".lobby__join");
        hold(".lobby__qr", ".lobby__join");
        hold(".lobby__join-step", ".lobby__join");
        hold(".lobby__campaigns", ".lobby");
        hold(".lobby__campaign", ".lobby__campaigns");
        const campaigns = [...document.querySelectorAll<HTMLElement>(".lobby__campaign")];
        // Seen, not merely laid out: drawn, sized, whole inside the pane and the screen, and the
        // top thing at its own middle.
        const seen = campaigns.filter(el => {
          const box = el.getBoundingClientRect();
          if (!el.checkVisibility({ opacityProperty: false, visibilityProperty: true }) || box.width < 1 || box.height < 1) return false;
          if (!within(box, pane) || !within(box, screen)) return false;
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return hit !== null && el.contains(hit);
        }).length;
        // One grid: the Room panel and the party share a top and a bottom (the cards' last row),
        // and the adventures span the two of them, edge to edge.
        const join = document.querySelector(".lobby__join")!.getBoundingClientRect();
        const party = document.querySelector(".lobby__party")!.getBoundingClientRect();
        const lineup = document.querySelector(".lobby__lineup")!.getBoundingClientRect();
        const row = document.querySelector(".lobby__campaigns")?.getBoundingClientRect();
        const near = (a: number, b: number) => Math.abs(a - b) <= 2;
        const misaligned = [
          near(join.top, party.top) ? null : `Room panel top ${join.top} vs party ${party.top}`,
          near(join.bottom, lineup.bottom) ? null : `Room panel bottom ${join.bottom} vs cards ${lineup.bottom}`,
          !row || near(row.left, join.left) ? null : `adventures left ${row.left} vs Room panel ${join.left}`,
          !row || near(row.right, party.right) ? null : `adventures right ${row.right} vs party ${party.right}`,
        ].filter(Boolean);
        // The cards sit straight under the heading, with no empty band between them, and stretch
        // to the Room panel's foot (checked above with the panels' alignment).
        const heading = document.querySelector(".lobby__party-heading")!;
        const headingBox = heading.getBoundingClientRect();
        const cardTop = Math.min(...[...document.querySelectorAll<HTMLElement>(".lobby-member")].map(el => el.getBoundingClientRect().top));
        const band = Math.round(cardTop - headingBox.bottom);
        // Where things stand, to hold still between waiting and all ready.
        const box = (el: Element | null) => { const r = el!.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(n => Math.round(n)); };
        const boxes: Record<string, number[]> = { room: box(document.querySelector(".lobby__join")), heading: [box(heading)[1], box(heading)[3]], lineup: box(document.querySelector(".lobby__lineup")) };
        document.querySelectorAll(".lobby-member").forEach((el, i) => { boxes[`card ${i}`] = box(el); });
        document.querySelectorAll(".lobby-member__portrait").forEach((el, i) => { boxes[`portrait ${i}`] = box(el); });
        const portrait = Math.min(...[...document.querySelectorAll<HTMLElement>(".lobby-member__portrait")].map(el => el.getBoundingClientRect().height));
        // The picked adventure's "Selected" tag: inside its card, and beside its title or directly
        // under it, never stranded in a corner of the card.
        const picked = document.querySelector(".lobby__campaign--picked")!;
        const pickedBox = picked.getBoundingClientRect();
        const titleRow = picked.querySelector(".lobby__campaign-title")!.getBoundingClientRect();
        const titleText = picked.querySelector(".lobby__campaign-title > span:not(.lobby__campaign-selected)")!.getBoundingClientRect();
        const tag = picked.querySelector(".lobby__campaign-selected")!.getBoundingClientRect();
        const tagMiddle = (tag.top + tag.bottom) / 2;
        const tagPlace = !within(tag, pickedBox) ? "outside its card" :
          tagMiddle >= titleText.top && tagMiddle <= titleText.bottom && tag.left >= titleText.right - 1 && tag.left - titleText.right <= 24 ? "beside" :
          tag.top >= titleText.bottom - 2 && tag.top - titleText.bottom <= 8 && Math.abs(tag.left - titleRow.left) <= 2 ? "under" :
          `stranded at ${Math.round(tag.left - pickedBox.left)},${Math.round(tag.top - pickedBox.top)} of its card (title ends at ${Math.round(titleText.right - pickedBox.left)},${Math.round(titleText.bottom - pickedBox.top)})`;
        const name = Math.min(...[...document.querySelectorAll<HTMLElement>(".lobby-member__name")].map(el => parseFloat(getComputedStyle(el).fontSize)));
        // The camp's window and the factor its figures are drawn at there (world/camp-framing.ts).
        const [insetsPath, campPath, framingPath] = ["/src/world/stage-inset.ts", "/src/world/lobby-camp.ts", "/src/world/camp-framing.ts"];
        const insets = await import(insetsPath);
        const camp = await import(campPath);
        const framing = await import(framingPath);
        const layout = camp.lobbyCampLayout()!;
        const heights = camp.campHeroes(useGameStore.getState().state).map((hero: { figure: { heightCm: number } }) => hero.figure.heightCm);
        const window = framing.campWindow(pane.height, insets.lobbyInsetTop(), insets.lobbyInsetBottom());
        const k = framing.campFigureScale(pane.width, window, layout, heights);
        return { options: options.length, campaigns: campaigns.length, seen, spills, misaligned, name, portrait, band, boxes, tagPlace, headingText: heading.textContent?.trim() ?? "", windowHeight: Math.round(window.bottom - window.top), k: Math.round(k * 100) / 100 };
      });
      const label = `${viewport.width}x${viewport.height} ${viewport.text}${viewport.ready ? " ready" : ""}${viewport.visitors ? " visitors" : ""}`;
      report.push(`${label}: window ${fit.windowHeight}px, k ${fit.k}, names ${fit.name}px, portraits ${Math.round(fit.portrait)}px, Selected ${fit.tagPlace}`);
      const key = `${viewport.width}x${viewport.height}`;
      if (viewport.text === "normal" && !viewport.visitors) {
        normalName.set(key, Math.min(normalName.get(key) ?? Infinity, fit.name));
        normalPortrait.set(key, Math.min(normalPortrait.get(key) ?? Infinity, fit.portrait));
      }
      // The heading says when everyone is ready, in place of its count, and nothing else moves.
      expect.soft(fit.headingText, `${label}: the party's heading`).toBe(viewport.ready ? "Everyone is ready! Start on a phone." : "The party (0/4 ready)");
      const stateKey = `${key} ${viewport.text}${viewport.visitors ? " visitors" : ""}`;
      if (!viewport.ready) waitingBoxes.set(stateKey, fit.boxes);
      else if (waitingBoxes.has(stateKey)) expect.soft(fit.boxes, `${label}: the Room panel, the heading's row and the cards stay put when everyone is ready`).toEqual(waitingBoxes.get(stateKey));
      expect.soft(fit.band, `${label}: the cards sit straight under the heading`).toBeLessThanOrEqual(12);
      expect.soft(fit.tagPlace, `${label}: Selected sits by the adventure's title`).toMatch(/^(beside|under)$/);
      if (viewport.text === "largest") expect.soft(fit.portrait, `${label}: portraits at the largest text are no smaller than at normal`).toBeGreaterThanOrEqual((normalPortrait.get(key) ?? 0) - 0.5);
      expect.soft(fit.options, `${label}: the room offers two adventures`).toBeGreaterThan(1);
      expect.soft({ campaigns: fit.campaigns, seen: fit.seen }, `${label}: every adventure is on screen`).toEqual({ campaigns: fit.options, seen: fit.options });
      expect.soft(fit.spills, `${label}: nothing spills out of its panel or the pane`).toEqual([]);
      expect.soft(fit.misaligned, `${label}: the panels line up`).toEqual([]);
      if (viewport.text === "largest") expect.soft(fit.name, `${label}: names at the largest text are no smaller than at normal`).toBeGreaterThanOrEqual(normalName.get(key) ?? 0);
      expect.soft(layout, label).toEqual({ inCornerRow: true, clearOfCorner: true, windowUnderRow: true, equalType: true, noHeaderBackground: true, crewInHeader: true, crewBesideTable: true, joinBesideParty: true, joinContainsCodeAndQr: true, qrSquare: true, campaignsBelowParty: true, overflow: false, outside: [] });
    }
    console.log(report.join("\n"));
  } finally { await context.close(); }
});

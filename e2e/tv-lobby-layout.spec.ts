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
    for (const viewport of [
      { width: 1280, height: 720, text: "normal", ready: false, visitors: false },
      { width: 1920, height: 1080, text: "normal", ready: false, visitors: false },
      { width: 1024, height: 600, text: "largest", ready: false, visitors: false },
      { width: 1024, height: 600, text: "largest", ready: true, visitors: false },
      { width: 1280, height: 720, text: "normal", ready: true, visitors: true },
    ]) {
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
      expect(brokenNames, "hero names must remain whole and contained").toEqual([]);
      await page.screenshot({ path: info.outputPath(`tv-${viewport.width}-${viewport.text}-${viewport.ready ? "ready" : "waiting"}${viewport.visitors ? "-visitors" : ""}.png`) });
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
      expect(layout).toEqual({ inCornerRow: true, clearOfCorner: true, windowUnderRow: true, equalType: true, noHeaderBackground: true, crewInHeader: true, crewBesideTable: true, joinBesideParty: true, joinContainsCodeAndQr: true, qrSquare: true, campaignsBelowParty: true, overflow: false, outside: [] });
    }
  } finally { await context.close(); }
});

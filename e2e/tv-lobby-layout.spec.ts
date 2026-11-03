import { test, expect } from "@playwright/test";
import { seedTable, openTv, onAir } from "./seed";

test("TV lobby uses one identity header and keeps joining beside four heroes", async ({ browser }, info) => {
  const table = await seedTable({ mode: "party", tv: true, ready: false, heroes: [
    { name: "Sparklehoof", species: "unicorn" }, { name: "Windstep", species: "griffin" },
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
      await page.screenshot({ path: info.outputPath(`tv-${viewport.width}-${viewport.text}-${viewport.ready ? "ready" : "waiting"}${viewport.visitors ? "-visitors" : ""}.png`) });
      const layout = await page.evaluate(() => {
        const frames = [...document.querySelectorAll<HTMLElement>(".lobby__header > .lobby__heading, .lobby__header > .lobby__place, .lobby__header > .lobby__crew")].map(el => el.getBoundingClientRect());
        const fonts = [...document.querySelectorAll<HTMLElement>(".lobby__heading > span:last-child, .lobby__header > .lobby__place > span:last-child, .lobby__header .crew-identity__name")].map(el => { const style = getComputedStyle(el); return [style.fontSize, style.fontFamily, style.fontWeight].join("|"); });
        const headerStyle = getComputedStyle(document.querySelector(".lobby__header")!);
        const header = document.querySelector(".lobby__header")!.getBoundingClientRect();
        const crew = document.querySelector(".lobby__header .crew-identity")!.getBoundingClientRect();
        const table = document.querySelector(".lobby__header > .lobby__place")!.getBoundingClientRect();
        const join = document.querySelector(".lobby__join")!.getBoundingClientRect();
        const party = document.querySelector(".lobby__party")!.getBoundingClientRect();
        const campaigns = document.querySelector(".lobby__campaigns")!.getBoundingClientRect();
        const lobby = document.querySelector<HTMLElement>(".lobby")!;
        return {
          equalFrames: Math.max(...frames.map(box => box.width)) - Math.min(...frames.map(box => box.width)) < 1 && Math.max(...frames.map(box => box.height)) - Math.min(...frames.map(box => box.height)) < 1,
          equalType: new Set(fonts).size === 1,
          noHeaderBackground: headerStyle.backgroundImage === "none" && headerStyle.backgroundColor === "rgba(0, 0, 0, 0)",
          crewInHeader: crew.top >= header.top && crew.bottom <= header.bottom,
          crewBesideTable: crew.left >= table.right,
          joinBesideParty: join.right < party.left,
          campaignsBelowParty: campaigns.top >= Math.max(join.bottom, ...[...document.querySelectorAll(".lobby-member")].map(el => el.getBoundingClientRect().bottom)),
          overflow: lobby.scrollHeight > lobby.clientHeight + 1,
          outside: [...document.querySelectorAll<HTMLElement>(".lobby__header, .lobby__campaign, .lobby__join, .lobby-member")].filter(el => {
            const box = el.getBoundingClientRect();
            return box.bottom > innerHeight + 1 || box.right > innerWidth + 1 || box.left < 0;
          }).map(el => el.className),
        };
      });
      expect(layout).toEqual({ equalFrames: true, equalType: true, noHeaderBackground: true, crewInHeader: true, crewBesideTable: true, joinBesideParty: true, campaignsBelowParty: true, overflow: false, outside: [] });
    }
  } finally { await context.close(); }
});

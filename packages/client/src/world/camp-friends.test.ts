// @vitest-environment jsdom
/**
 * The camp's friends on the screens (#624, docs/camp.md §4.4, §8.5, §8.7):
 * who is out and where each stands, a friend tapped on a phone acting it out
 * on the TV (its words, then a walk over to the kid's hero), the TV queueing
 * and dropping what a hammered button still lets through, and reduced motion
 * keeping the words and dropping the walk. Frame by frame against the fake
 * stage, on the real manifest's camp.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Texture, type Application } from "pixi.js";
import manifest from "../../../../assets/manifest.json";
import catalog from "../../../../content/camp.json";
import type { CampFriendCard, RunState } from "@kad/shared";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { createCamp, type CampFigure, type CampStage } from "./camp";
import { campLayout, parseCampManifest } from "./camp-layout";
import { FRIEND_SPOTS, campFriendFigures, friendFigure, friendHabit, friendHeightCm, friendSpots } from "./camp-friends";
import { REACT_S, TAP_WAITING, WORDS_S, createTapQueue, type FriendTap } from "./camp-taps";
import { stillCampFigures } from "./lobby-camp";

beforeAll(installFakeCanvas2D);

const parsed = parseCampManifest((manifest as { camp: unknown }).camp);
const CARDS = (catalog.friends as (CampFriendCard & { offers: unknown; reactions: string[] })[]).map(({ id, name, figure, size }) => ({ id, name, figure, ...(size ? { size } : {}) }));
const card = (id: string): CampFriendCard => CARDS.find((c) => c.id === id)!;

const moment = (out: string[]): Pick<RunState, "campMoment"> => ({
  campMoment: { id: "lobby|r:-:0", kind: "lobby", outdoor: true, changes: {}, friends: { rotation: out, out, cards: CARDS } },
});

describe("who stands where (§4.4)", () => {
  it("draws every friend out at its true height, the tallest at the roomy spot 0, the rest kept where they were", () => {
    const figures = campFriendFigures(moment(["duckling", "kid_goat", "mosshorn", "bun"]));
    expect(figures.map((f) => [f.id, f.friend])).toEqual([
      ["friend:duckling", 1],
      ["friend:kid_goat", 2],
      ["friend:mosshorn", 0],
      ["friend:bun", 3],
    ]);
    // The mosshorn as Gemfall 4B casts it, a small one; Bun her own 45 cm.
    expect(figures.find((f) => f.id === "friend:mosshorn")?.heightCm).toBe(75);
    expect(figures.find((f) => f.id === "friend:bun")?.heightCm).toBe(45);
    expect(figures.every((f) => f.url?.startsWith("/assets/"))).toBe(true);
    // A buddy coming out takes a free spot; nobody else moves.
    const before = new Map([["duckling", 1], ["kid_goat", 2]]);
    expect(friendSpots(before, ["bun", "duckling", "kid_goat"], new Map([["bun", 45], ["duckling", 20], ["kid_goat", 45]]))).toEqual(
      new Map([["bun", 0], ["duckling", 1], ["kid_goat", 2]]),
    );
  });

  it("never draws more than four, and none at a camp with no friends", () => {
    expect(campFriendFigures(moment(["bun", "mosshorn", "duckling", "kid_goat", "bun"]))).toHaveLength(FRIEND_SPOTS);
    expect(campFriendFigures({ campMoment: { id: "x", kind: "lobby", outdoor: true, changes: {} } })).toEqual([]);
  });

  it("stands each friend at its own spot in the still camp too", () => {
    const layout = campLayout(parsed, "open_plains", 2);
    const friends = campFriendFigures(moment(["bun", "mosshorn"])).map((figure) => ({ figure, ready: false, away: false }));
    const still = stillCampFigures(layout, friends);
    for (const f of still) {
      const spot = layout.frame.standPoints.find((p) => p.friend === friends.find((g) => g.figure.id === f.id)!.figure.friend)!;
      expect(f.x).toBeCloseTo(spot.x, 2);
      expect(f.friend).toBeTruthy();
    }
  });

});

describe("fireside habits (#651)", () => {
  it("gives Bun, the duckling and the mosshorn their habits wherever the rotation stands them, and the kid goat none yet", () => {
    expect(friendFigure(card("bun"), 3).habit).toBe("bun");
    expect(friendFigure(card("duckling"), 0).habit).toBe("duckling");
    expect(friendFigure(card("mosshorn"), 2).habit).toBe("mosshorn");
    expect(friendFigure(card("kid_goat"), 1)).not.toHaveProperty("habit");
    expect(friendHabit("toString")).toBeUndefined();
  });

  it("lets the mosshorn carry its leaf while it wanders and drop it each time it settles", () => {
    const layout = campLayout(parsed, "open_plains", 2);
    const app = fakeApp();
    const stage = createCamp(app as unknown as Application, layout, { seed: 3, loadTexture: () => Promise.resolve(Texture.WHITE) });
    stage.resize(1920, 1080);
    stage.setFigures([friendFigure(card("mosshorn"), 0)]);
    return Promise.resolve().then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
      const leaf = () => stage.view.getChildByLabel("mosshorn-leaf", true)!;
      let carried = false;
      let dropped = false;
      for (let t = 0; t < 60 && !(carried && dropped); t += 0.05) {
        app.ticker.frame(50);
        const me = figure(stage, "friend:mosshorn");
        if (me.walking && leaf().rotation === 0) carried = true;
        if (!me.walking && leaf().rotation < -0.79) dropped = true;
      }
      expect(leaf()).toBeTruthy();
      expect(dropped).toBe(true);
      expect(carried).toBe(true);
      stage.destroy();
    });
  });
});

describe("the TV's queue (§8.5)", () => {
  const tap = (heroId: string, words = "Peep!"): FriendTap => ({ figureId: "friend:duckling", heroId, words });

  it("acts out one tap at a time, holds one more, and drops the rest", () => {
    const queue = createTapQueue();
    const verdicts = Array.from({ length: 20 }, (_, i) => queue.offer(tap(i % 2 ? "hero_a" : "hero_b"), i * 0.05));
    expect(verdicts[0]).toBe("start");
    expect(verdicts.filter((v) => v === "waiting")).toHaveLength(TAP_WAITING);
    expect(verdicts.filter((v) => v === "dropped")).toHaveLength(20 - 1 - TAP_WAITING);
    // Nothing more starts until the first is done, and then only after a rest.
    expect(queue.due(5)).toEqual([]);
    queue.finish("friend:duckling", 5);
    expect(queue.due(5)).toEqual([]);
    expect(queue.due(6)).toHaveLength(1);
    expect(queue.waiting("friend:duckling")).toEqual([]);
  });

  it("drops the same kid again while hers waits", () => {
    const queue = createTapQueue();
    expect(queue.offer(tap("hero_a"), 0)).toBe("start");
    expect(queue.offer(tap("hero_b"), 0.1)).toBe("waiting");
    expect(queue.offer(tap("hero_b"), 0.2)).toBe("dropped");
  });
});

/** A stage-2 camp with two heroes and a duckling and a kid goat out. */
function camp(still = false): { app: FakeApp; stage: CampStage } {
  const layout = campLayout(parsed, "open_plains", 2);
  const app = fakeApp();
  const stage = createCamp(app as unknown as Application, layout, { still, seed: 7, loadTexture: () => Promise.resolve(Texture.WHITE) });
  stage.resize(1920, 1080);
  const heroes: CampFigure[] = [
    { id: "hero_a", url: null, heightCm: 165, stance: "standing", seat: 0 },
    { id: "hero_b", url: null, heightCm: 85, stance: "standing", seat: 3 },
  ];
  stage.setFigures([...heroes, friendFigure(card("duckling"), 1), friendFigure(card("kid_goat"), 2)]);
  return { app, stage };
}

const run = (app: FakeApp, seconds: number, step = 0.05): void => {
  for (let t = 0; t < seconds; t += step) app.ticker.frame(step * 1000);
};
const figure = (stage: CampStage, id: string) => stage.figures().find((f) => f.id === id)!;

describe("a friend tapped on a phone, on the TV (§4.4, §8.5)", () => {
  it("says its words, then walks over to the tapping kid's hero and stands beside her", () => {
    const { app, stage } = camp();
    run(app, 1);
    const start = figure(stage, "friend:duckling");
    expect(stage.tapFriend({ figureId: "friend:duckling", heroId: "hero_b", words: "Peep! The duckling waddles in a happy circle." })).toBe("start");
    run(app, 0.1);
    expect(stage.friendWords()).toEqual([{ id: "friend:duckling", words: "Peep! The duckling waddles in a happy circle." }]);
    // It reacts where it stands first.
    run(app, REACT_S - 0.3);
    expect(figure(stage, "friend:duckling").x).toBeCloseTo(start.x, 0);
    // Over it walks, and stops beside her, on her lane.
    let beside = false;
    // A duckling's steps are small: across the camp takes a while, and she waits for it.
    for (let t = 0; t < 40 && !beside; t += 0.05) {
      app.ticker.frame(50);
      const hero = figure(stage, "hero_b");
      const friend = figure(stage, "friend:duckling");
      beside = !friend.walking && friend.lane === hero.lane && Math.abs(friend.x - hero.x) < 0.12 * 1920 && friend.alpha > 0.9;
    }
    expect(beside).toBe(true);
    run(app, WORDS_S);
    // Its words are gone once their time is up.
    expect(stage.friendWords()).toEqual([]);
    stage.destroy();
  });

  it("hammered by two kids, a happy friend: one walk at a time, never back and forth on the way", () => {
    const { app, stage } = camp();
    run(app, 1);
    const verdicts = [];
    for (let i = 0; i < 40; i++) {
      verdicts.push(stage.tapFriend({ figureId: "friend:kid_goat", heroId: i % 2 ? "hero_a" : "hero_b", words: `Maa ${String(i)}` }));
      run(app, 0.05);
    }
    expect(verdicts.filter((v) => v === "start")).toHaveLength(1);
    expect(verdicts.filter((v) => v === "waiting")).toHaveLength(TAP_WAITING);
    // Over the next while it walks to one hero, then the other: never a turn in the middle of a walk.
    let last = figure(stage, "friend:kid_goat");
    let direction = 0;
    let turns = 0;
    let walkingFrames = 0;
    for (let t = 0; t < 30; t += 0.05) {
      app.ticker.frame(50);
      const now = figure(stage, "friend:kid_goat");
      if (now.walking) {
        walkingFrames++;
        const d = Math.sign(now.x - last.x);
        if (d !== 0 && direction !== 0 && d !== direction) turns++;
        if (d !== 0) direction = d;
      } else direction = 0;
      last = now;
    }
    expect(walkingFrames).toBeGreaterThan(0);
    expect(turns).toBeLessThanOrEqual(1);
    stage.destroy();
  });

  it("in reduced motion, shows the words and does not walk", () => {
    const { app, stage } = camp(true);
    run(app, 1);
    const start = figure(stage, "friend:duckling");
    expect(stage.tapFriend({ figureId: "friend:duckling", heroId: "hero_b", words: "Peep peep!" })).toBe("start");
    run(app, 0.2);
    expect(stage.friendWords()).toEqual([{ id: "friend:duckling", words: "Peep peep!" }]);
    run(app, WORDS_S + 1);
    const end = figure(stage, "friend:duckling");
    expect(end.x).toBeCloseTo(start.x, 3);
    expect(end.lane).toBe(start.lane);
    expect(stage.friendWords()).toEqual([]);
    // And the next tap can play.
    expect(stage.tapFriend({ figureId: "friend:duckling", heroId: "hero_a", words: "Again!" })).toBe("start");
    stage.destroy();
  });

  it("drops a tap for nobody in camp, or for a hero", () => {
    const { stage } = camp();
    expect(stage.tapFriend({ figureId: "friend:mosshorn", heroId: "hero_a", words: "Hm." })).toBe("dropped");
    expect(stage.tapFriend({ figureId: "hero_a", heroId: "hero_b", words: "Hi." })).toBe("dropped");
    stage.destroy();
  });
});

describe("a full camp: four heroes, four friends (§4.4)", () => {
  for (const stageNo of [1, 2]) {
    it(`at stage ${String(stageNo)}, every friend tapped gets over to the hero who called it, walking or (the way full) by a fade`, () => {
      const layout = campLayout(parsed, "open_plains", stageNo);
      const heroes: CampFigure[] = [
        { id: "moss", url: null, heightCm: 215, stance: "standing", seat: 0, species: "bigfoot" },
        { id: "kit", url: null, heightCm: 85, stance: "standing", seat: 1, species: "kitsune" },
        { id: "aster", url: null, heightCm: 165, stance: "standing", seat: 2, species: "unicorn" },
        { id: "fern", url: null, heightCm: 160, stance: "standing", seat: 3, species: "griffin" },
      ];
      const friends = campFriendFigures(moment(["kid_goat", "duckling", "mosshorn", "bun"]));
      for (const [friendId, heroId] of [["mosshorn", "fern"], ["bun", "moss"], ["duckling", "aster"], ["kid_goat", "kit"]] as const) {
        const app = fakeApp();
        const stage = createCamp(app as unknown as Application, layout, { seed: 11, loadTexture: () => Promise.resolve(Texture.WHITE) });
        stage.resize(1920, 1080);
        stage.setInset(232, 66);
        stage.setFigures([...heroes, ...friends]);
        run(app, 2);
        expect(stage.tapFriend({ figureId: `friend:${friendId}`, heroId, words: "Hi!" })).toBe("start");
        let beside = false;
        for (let t = 0; t < 60 && !beside; t += 0.05) {
          app.ticker.frame(50);
          const hero = figure(stage, heroId);
          const friend = figure(stage, `friend:${friendId}`);
          beside = !friend.walking && friend.lane === hero.lane && Math.abs(friend.x - hero.x) < 0.15 * 1920 && friend.alpha > 0.9;
        }
        expect(beside, `${friendId} to ${heroId}`).toBe(true);
        stage.destroy();
      }
    });
  }
});

describe("friends wander like heroes (§8.5)", () => {
  it("never stand at a hero's seat, a piece's action spot, or another friend's spot", () => {
    const { app, stage } = camp();
    const layout = campLayout(parsed, "open_plains", 2);
    for (let t = 0; t < 240; t += 0.25) {
      app.ticker.frame(250);
      for (const f of stage.figures().filter((g) => g.id.startsWith("friend:"))) {
        if (!f.point) continue;
        const point = layout.frame.standPoints.find((p) => p.id === f.point)!;
        expect(point.seat, f.point).toBeUndefined();
        expect(point.action, f.point).toBeUndefined();
        if (point.friend !== undefined) expect(f.id).toBe(point.friend === 1 ? "friend:duckling" : "friend:kid_goat");
      }
    }
    stage.destroy();
  });
});

it("sizes each friend at its band, and its own height without one", () => {
  expect(friendHeightCm({ figure: "entities/mosshorn", size: "small" })).toBe(75);
  expect(friendHeightCm({ figure: "entities/mosshorn" })).toBe(150);
  expect(friendHeightCm(card("duckling"))).toBe(20);
});

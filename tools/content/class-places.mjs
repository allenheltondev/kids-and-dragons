/**
 * Class places: can every party reach all four? (#313, docs/class-mastery.md §2)
 *
 * A class place is a side room of an existing place, a story or choice_point
 * scene marked `classPlace`, entered from that place's `rest` scene. Every
 * graph campaign has all four reachable, and "reachable" means by a way every
 * party has: a way gated by a flag, an item, a species, a class, a world fact
 * or a lock is a bonus, never the only way in.
 *
 * Judged the way the continuity sweep reads a graph (continuity.mjs): places
 * and ways, never journeys. The scene exits are `sceneExits`, the chapter's
 * own reading of its branches; a condition is read with `whenConditions`' kin.
 * What differs is the question. The sweep asks what a way PROVES was shown;
 * this asks whether a way is OPEN, and the sweep's own answer decides the two
 * progress gates it can prove something about:
 *
 *   - `completed: X` and `visited: X` are open when X is itself reached by open
 *     ways. Any party can go to X first, so the gate hides nothing from them.
 *   - Everything else (`flag`, `item`, `facts`, `outcome`, `count`, `locked`,
 *     a rift with a lifecycle rule, `requiresSpecies`, `requiresClass`, ...) is a gate: it depends on who the
 *     party is or on what they chose, so the way does not count.
 *
 * Only a node's own chapter counts. A node variant is chosen by a `when`, so a
 * room that exists only in a variant is gated by definition.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sceneExits } from "./continuity.mjs";

export const ALLOW_PATH = join(dirname(fileURLToPath(import.meta.url)), "class-place-allow.json");

const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Whether a chapter choice is available to every party (no `requires*`, no `when`). */
function choiceOpen(choice) {
  return !(choice.requiresSpecies || choice.requiresClass || choice.requiresFlag || choice.requiresItem || choice.when);
}

/**
 * Whether a graph condition leaves a way open, given the nodes already open.
 * Only `completed` and `visited` of an open node qualify; any other key set
 * on the condition is a gate.
 */
function graphWhenOpen(when, open) {
  if (!when) return true;
  for (const [key, value] of Object.entries(when)) {
    if (value === undefined) continue;
    if (key !== "completed" && key !== "visited") return false;
    if (!asList(value).every((id) => open.has(id))) return false;
  }
  return true;
}

/**
 * Whether a rift is crossable by every party. A rift with a condition or a
 * moving part is not: `opensWhen` waits on the journey, `lasts` expires,
 * `unstable` flickers or collapses, `linkedTo` shares a state another crossing
 * can spend, and `actions` can close or turn it. `uses` is not one of them: it
 * only limits LATER crossings, so a one-use rift still lets every party through
 * once, which is all reaching a room asks. `oneWay`, `persistent`, `reveal` and
 * a bare `redirects` list change what the players see, not who can cross.
 */
function riftOpen(rift) {
  if (!rift) return true;
  return ["opensWhen", "lasts", "unstable", "linkedTo", "actions"].every((key) => rift[key] === undefined);
}

/** Nodes a party can reach by open ways alone, to a fixed point (a `completed` gate opens as its node does). */
export function openNodes(graph) {
  const open = new Set([graph.entry]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of Object.values(graph.edges ?? {})) {
      if (!open.has(edge.from) || open.has(edge.to) || !graph.nodes?.[edge.to]) continue;
      if (edge.locked || !riftOpen(edge.rift) || !graphWhenOpen(edge.when, open)) continue;
      open.add(edge.to);
      changed = true;
    }
  }
  return open;
}

/** Every node the graph can reach at all, gates ignored. */
function anyNodes(graph) {
  const seen = new Set([graph.entry]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of Object.values(graph.edges ?? {})) {
      if (seen.has(edge.from) && !seen.has(edge.to) && graph.nodes?.[edge.to]) seen.add(edge.to), (changed = true);
    }
  }
  return seen;
}

/** Scenes a party reaches from a chapter's entry without meeting a gated choice. A check or fight offers every branch. */
function openScenes(chapter) {
  const seen = new Set([chapter.entry]);
  for (const queue = [chapter.entry]; queue.length; ) {
    const scene = chapter.scenes[queue.shift()];
    if (!scene) continue;
    for (const exit of sceneExits(scene)) {
      if (exit.choice && !choiceOpen(exit.choice)) continue;
      if (chapter.scenes[exit.to] && !seen.has(exit.to)) seen.add(exit.to), queue.push(exit.to);
    }
  }
  return seen;
}

/**
 * What a graph campaign gives a party, class by class.
 *
 * @param {object} campaign  a graph campaign
 * @param {object[]} chapters  its loaded chapters
 * @param {string[]} classIds  the classes in content/rules.json
 * @returns {{ rooms: Map<string, {status: "open"|"gated"|"missing", where?: string}>, notOffRest: {chapter: string, scene: string, classId: string}[] }}
 */
export function classPlaceReach(campaign, chapters, classIds) {
  const g = campaign.graph;
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const open = openNodes(g);
  const any = anyNodes(g);
  const rooms = new Map(classIds.map((id) => [id, { status: "missing" }]));
  const notOffRest = [];

  for (const [nodeId, node] of Object.entries(g.nodes ?? {})) {
    const chapter = byId.get(node.chapter);
    if (!chapter) continue;
    const reachable = openScenes(chapter);
    // Every way into a scene from a rest scene, and the ones a party can use.
    const fromRest = new Map();
    for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
      if (scene.type !== "rest") continue;
      for (const exit of sceneExits(scene)) {
        const way = fromRest.get(exit.to) ?? { any: false, open: false };
        way.any = true;
        way.open ||= reachable.has(sceneId) && exit.choice && choiceOpen(exit.choice);
        fromRest.set(exit.to, way);
      }
    }
    for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
      const classId = scene.classPlace;
      if (classId === undefined || !rooms.has(classId)) continue;
      const way = fromRest.get(sceneId);
      if (!way) {
        notOffRest.push({ chapter: chapter.id, scene: sceneId, classId });
        continue;
      }
      const room = rooms.get(classId);
      if (room.status === "open") continue;
      const isOpen = open.has(nodeId) && way.open;
      if (isOpen) rooms.set(classId, { status: "open", where: `${chapter.id}/${sceneId}` });
      else if (any.has(nodeId)) rooms.set(classId, { status: "gated", where: `${chapter.id}/${sceneId}` });
    }
  }
  return { rooms, notOffRest };
}

/** `{ "<campaignId>": "reason" }`: graph campaigns allowed to lack rooms until #315 writes them. */
export function loadAllowList(path = ALLOW_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The verdict on one campaign: errors fail `content:validate`, warnings print.
 * An allow-listed campaign with a gap warns (the gap stays visible); one with
 * no gap errors, because the entry is stale and the switch is on for it.
 */
export function classPlaceVerdict(campaignId, reach, allow = {}) {
  const errors = [];
  const warnings = [];
  const allowed = Object.hasOwn(allow, campaignId);
  const gaps = [];
  for (const [classId, room] of reach.rooms) {
    if (room.status === "missing") gaps.push(`${classId}: no scene in this campaign's chapters is marked classPlace "${classId}"`);
    else if (room.status === "gated") gaps.push(`${classId}: the only way to ${room.where} is gated (a flag, item, species, class, world fact or lock), so some parties never get there`);
  }
  for (const { chapter, scene, classId } of reach.notOffRest) {
    gaps.push(`${classId}: ${chapter}/${scene} is a class place but no rest scene leads to it`);
  }
  if (!gaps.length) {
    if (allowed) errors.push(`${campaignId} is in tools/content/class-place-allow.json but now reaches every class place - remove the entry`);
    return { errors, warnings };
  }
  if (allowed) {
    for (const gap of gaps) warnings.push(`${campaignId} (allowed until the class places land): ${gap}`);
    return { errors, warnings };
  }
  for (const gap of gaps) errors.push(gap);
  return { errors, warnings };
}

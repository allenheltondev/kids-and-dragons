/**
 * Chapter graph — static analysis.
 *
 * architecture §5: "A chapter that references an unknown `itemId`, or an invalid
 * scene graph, **fails the build** — not the play session." This module is that
 * check. CI runs it over `content/chapters/*.json`; the authoring tool (roadmap
 * chapter 6) runs the same function to draw dead ends and orphans in its editor.
 *
 * Conventions this encodes, because the chapter schema has no explicit marker
 * for them:
 *
 *   - A scene with **no outgoing edges ends the chapter.** That's how a chapter
 *     finishes, so it is not an error. A chapter with no such scene *is*
 *     flagged (`NO_ENDING`) — it can never complete.
 *   - A scene whose every choice carries a requirement is a `DEAD_END`, because
 *     unmet requirements *hide* choices (§5) rather than disabling them. A party
 *     that matches none of them sees a scene with nothing to tap.
 */

import type {
  Chapter,
  Choice,
  Effect,
  Scene,
  SceneId,
} from "./types/chapter.js";
import type { ItemCatalog, ResolvedCharacter } from "./types/domain.js";

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "MISSING_ENTRY"
  | "UNKNOWN_ENTRY"
  | "UNKNOWN_GOTO"
  | "UNREACHABLE_SCENE"
  | "DEAD_END"
  | "NO_ENDING"
  | "MISSING_BRANCH"
  | "DUPLICATE_CHOICE_ID"
  | "UNKNOWN_ITEM"
  | "ITEM_KIND_MISMATCH"
  | "NO_SCENES";

export interface ChapterIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  sceneId?: SceneId;
}

/** Every scene a scene can lead to, with a label for the error message. */
interface Edge {
  to: SceneId;
  via: string;
}

export function sceneEdges(scene: Scene): Edge[] {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return scene.choices.map((c) => ({ to: c.goto, via: `choice "${c.id}"` }));
    case "check":
      return [
        ...(scene.onSuccess ? [{ to: scene.onSuccess.goto, via: "onSuccess" }] : []),
        ...(scene.onFailure ? [{ to: scene.onFailure.goto, via: "onFailure" }] : []),
      ];
    case "encounter":
      return [
        ...(scene.onVictory ? [{ to: scene.onVictory.goto, via: "onVictory" }] : []),
        ...(scene.onDefeat ? [{ to: scene.onDefeat.goto, via: "onDefeat" }] : []),
      ];
  }
}

/** Every effect a scene can fire, wherever it hangs. */
function sceneEffects(scene: Scene): Effect[] {
  const effects: Effect[] = [...(scene.onEnter ?? [])];
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      for (const choice of scene.choices) effects.push(...(choice.effects ?? []));
      break;
    case "check":
      effects.push(...(scene.onSuccess?.effects ?? []), ...(scene.onFailure?.effects ?? []));
      break;
    case "encounter":
      effects.push(...(scene.onVictory?.effects ?? []), ...(scene.onDefeat?.effects ?? []));
      break;
  }
  return effects;
}

export function sceneChoices(scene: Scene): Choice[] {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return scene.choices;
    default:
      return [];
  }
}

function isGated(choice: Choice): boolean {
  return (
    choice.requiresSpecies !== undefined ||
    choice.requiresFlag !== undefined ||
    choice.requiresItem !== undefined
  );
}

/**
 * Validates one chapter. Pass the item catalog to also check `itemId`
 * references; without it those checks are skipped rather than guessed at.
 *
 * Returns every issue found — the caller decides whether warnings fail the
 * build. Errors always should.
 */
export function validateChapter(chapter: Chapter, catalog?: ItemCatalog): ChapterIssue[] {
  const issues: ChapterIssue[] = [];
  const scenes = chapter.scenes ?? {};
  const ids = Object.keys(scenes);

  if (ids.length === 0) {
    issues.push({
      severity: "error",
      code: "NO_SCENES",
      message: `chapter "${chapter.id}" has no scenes`,
    });
    return issues;
  }

  // --- entry -------------------------------------------------------------
  if (!chapter.entry) {
    issues.push({
      severity: "error",
      code: "MISSING_ENTRY",
      message: `chapter "${chapter.id}" has no entry scene`,
    });
  } else if (!(chapter.entry in scenes)) {
    issues.push({
      severity: "error",
      code: "UNKNOWN_ENTRY",
      message: `entry "${chapter.entry}" is not a scene in this chapter`,
      sceneId: chapter.entry,
    });
  }

  // --- per scene ---------------------------------------------------------
  for (const sceneId of ids) {
    const scene = scenes[sceneId];
    if (!scene) continue;

    // Branch completeness. A check with one arm strands the other outcome; an
    // encounter without onDefeat would need a game over, which never exists
    // (spec §7.3).
    if (scene.type === "check") {
      if (!scene.onSuccess?.goto) {
        issues.push({
          severity: "error",
          code: "MISSING_BRANCH",
          message: `check scene "${sceneId}" has no onSuccess branch`,
          sceneId,
        });
      }
      if (!scene.onFailure?.goto) {
        issues.push({
          severity: "error",
          code: "MISSING_BRANCH",
          message: `check scene "${sceneId}" has no onFailure branch — failure must continue the story`,
          sceneId,
        });
      }
    }
    if (scene.type === "encounter") {
      if (!scene.onVictory?.goto) {
        issues.push({
          severity: "error",
          code: "MISSING_BRANCH",
          message: `encounter "${sceneId}" has no onVictory branch`,
          sceneId,
        });
      }
      if (!scene.onDefeat?.goto) {
        issues.push({
          severity: "error",
          code: "MISSING_BRANCH",
          message: `encounter "${sceneId}" has no onDefeat branch — a wipe branches the story, it never ends the game`,
          sceneId,
        });
      }
    }

    // Unknown goto targets.
    for (const edge of sceneEdges(scene)) {
      if (!edge.to || !(edge.to in scenes)) {
        issues.push({
          severity: "error",
          code: "UNKNOWN_GOTO",
          message: `scene "${sceneId}" ${edge.via} points at unknown scene "${edge.to}"`,
          sceneId,
        });
      }
    }

    // Duplicate choice ids — the client keys on them and the engine matches
    // an intent's choiceId against them, so a duplicate is ambiguous.
    const choices = sceneChoices(scene);
    const seen = new Set<string>();
    for (const choice of choices) {
      if (seen.has(choice.id)) {
        issues.push({
          severity: "error",
          code: "DUPLICATE_CHOICE_ID",
          message: `scene "${sceneId}" has two choices with id "${choice.id}"`,
          sceneId,
        });
      }
      seen.add(choice.id);
    }

    // Dead end: choices exist but every one of them can be hidden (§5).
    if (choices.length > 0 && choices.every(isGated)) {
      issues.push({
        severity: "error",
        code: "DEAD_END",
        message: `scene "${sceneId}" has no ungated choice — a party matching none of the requirements sees nothing to tap`,
        sceneId,
      });
    }

    // Item references.
    if (catalog) {
      for (const effect of sceneEffects(scene)) {
        if (effect.type === "grantItem" || effect.type === "grantQuestItem") {
          const def = catalog[effect.itemId];
          if (!def) {
            issues.push({
              severity: "error",
              code: "UNKNOWN_ITEM",
              message: `scene "${sceneId}" grants unknown item "${effect.itemId}"`,
              sceneId,
            });
            continue;
          }
          const wantQuest = effect.type === "grantQuestItem";
          if (wantQuest !== (def.kind === "quest")) {
            issues.push({
              severity: "error",
              code: "ITEM_KIND_MISMATCH",
              message: wantQuest
                ? `scene "${sceneId}" grants "${effect.itemId}" as a quest item but it is a ${def.kind}`
                : `scene "${sceneId}" grants quest item "${effect.itemId}" through grantItem — quest items are slot-free and must use grantQuestItem`,
              sceneId,
            });
          }
        }
      }
      for (const choice of choices) {
        if (choice.requiresItem && !catalog[choice.requiresItem]) {
          issues.push({
            severity: "error",
            code: "UNKNOWN_ITEM",
            message: `scene "${sceneId}" choice "${choice.id}" requires unknown item "${choice.requiresItem}"`,
            sceneId,
          });
        }
      }
    }
  }

  // --- reachability ------------------------------------------------------
  const reachable = reachableScenes(chapter);
  for (const sceneId of ids) {
    if (!reachable.has(sceneId)) {
      issues.push({
        severity: "warning",
        code: "UNREACHABLE_SCENE",
        message: `scene "${sceneId}" is not reachable from entry "${chapter.entry}"`,
        sceneId,
      });
    }
  }

  // --- can the chapter end? ---------------------------------------------
  const hasEnding = [...reachable].some((id) => {
    const scene = scenes[id];
    return scene ? sceneEdges(scene).length === 0 : false;
  });
  if (!hasEnding) {
    issues.push({
      severity: "warning",
      code: "NO_ENDING",
      message: `chapter "${chapter.id}" has no reachable scene without exits, so it never completes`,
    });
  }

  return issues;
}

/** Scenes reachable from `entry`, following every branch. */
export function reachableScenes(chapter: Chapter): Set<SceneId> {
  const scenes = chapter.scenes ?? {};
  const seen = new Set<SceneId>();
  if (!chapter.entry || !(chapter.entry in scenes)) return seen;
  const queue: SceneId[] = [chapter.entry];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const scene = scenes[id];
    if (!scene) continue;
    for (const edge of sceneEdges(scene)) {
      if (edge.to in scenes && !seen.has(edge.to)) queue.push(edge.to);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Choice gating — architecture §5
// ---------------------------------------------------------------------------

/** What a gate is evaluated against: who's here, and what the run remembers. */
export interface ChoiceParty {
  members: readonly ResolvedCharacter[];
  flags?: Record<string, boolean>;
}

function speciesMatches(choice: Choice, party: ChoiceParty): boolean {
  if (choice.requiresSpecies === undefined) return true;
  const wanted = Array.isArray(choice.requiresSpecies)
    ? choice.requiresSpecies
    : [choice.requiresSpecies];
  return party.members.some((m) => wanted.includes(m.species));
}

function itemMatches(choice: Choice, party: ChoiceParty): boolean {
  if (choice.requiresItem === undefined) return true;
  const itemId = choice.requiresItem;
  return party.members.some(
    (m) =>
      m.inventory.some((e) => e.itemId === itemId) || m.questItems.includes(itemId),
  );
}

/**
 * Filters a scene's choices down to what the party can actually see.
 *
 * Unmet requirements make a choice **hidden, never disabled** (architecture §5):
 * nobody feels locked out of something they can see, and "only my griffin can
 * do this" reads as a superpower rather than a paywall. Requirements are
 * satisfied by *anyone* in the party — this is a table game, not a solo one.
 */
export function visibleChoices(
  choices: readonly Choice[],
  party: ChoiceParty,
): Choice[] {
  const flags = party.flags ?? {};
  return choices.filter(
    (choice) =>
      speciesMatches(choice, party) &&
      itemMatches(choice, party) &&
      (choice.requiresFlag === undefined || flags[choice.requiresFlag] === true),
  );
}

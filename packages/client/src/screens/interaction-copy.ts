/**
 * The words a mini-game says about itself (#493 playtest follow-up).
 *
 * An authored `cue` is the story's line ("Loosen the packed rim in the supported interval").
 * It never says how the game is played, who holds the phone that matters, or where to look,
 * and a family at the table found that out the hard way. Everything here is the layer under
 * the cue: a plain name for each kind of game, one job line per person, and the line the TV
 * reads so the room knows whose phone to watch.
 *
 * Pure functions over the authoritative prompt, so the TV and every phone say the same thing.
 */

import { balanceReady, interactionActor, playReady, playbackMs, relayHolder, supportPlayers, supportsReady } from "@kad/shared";
import type { InteractionPrompt, InteractionSpec, PartyMember } from "@kad/shared";

export type InteractionKind = InteractionSpec["kind"];

/** A kid-readable name and icon for each kind of game, and how it is played, in one breath. */
export const GAME: Record<InteractionKind, { name: string; icon: string; how: string }> = {
  precision: { name: "Hit the gold", icon: "star", how: "A marker slides back and forth. One of you taps when it is in the gold." },
  timing: { name: "Wait for NOW", icon: "boot", how: "A lamp says Wait… then NOW! One of you taps on NOW." },
  memory: { name: "Copy the pattern", icon: "eye", how: "The TV shows a pattern. Then one of you taps it back in the same order." },
  sequence: { name: "Share the clues", icon: "map", how: "Every phone gets a clue. Read them out loud and put the steps in order." },
  tracking: { name: "Follow the glow", icon: "eye", how: "Watch where the glow starts. Follow it while the covers shuffle, then pick its cover." },
  balance: { name: "Hold it level", icon: "hand", how: "Everyone lifts a little. Lift more or ease down to bring the shared marker into the gold." },
  relay: { name: "Pass it along", icon: "forward", how: "Touch the arriving object to catch it. Slide it up to send it to your friend." },
  cooperate: { name: "All together", icon: "party", how: "Everyone presses and holds together. Keep holding while the object rises to the star." },
  play: { name: "Everyone joins in", icon: "heart", how: "Pick something to do. What you pick shows up on the TV. No wrong answers." },
};

export interface TableView {
  prompt: InteractionPrompt;
  party: readonly PartyMember[];
  /** Connected player ids, in party order. */
  connected: readonly string[];
  now: number;
}

function nameOf(party: readonly PartyMember[], id: string | undefined): string {
  return party.find((member) => member.playerId === id)?.character.name ?? "Your friend";
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "Everyone";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The one person whose phone drives this game right now. */
export function leadOf(view: TableView): string | undefined {
  return interactionActor(view.prompt, view.connected);
}

/** True while a memory or tracking game is still showing its pattern. */
export function showing(view: TableView): boolean {
  const { prompt, now } = view;
  if (prompt.phase !== "active" || prompt.relaxed) return false;
  if (prompt.spec.kind !== "memory" && prompt.spec.kind !== "tracking") return false;
  return now - Date.parse(prompt.startedAt ?? "") < playbackMs(prompt.spec, false) + 250;
}

/**
 * The line the TV reads under the board: who does what next, and on which screen.
 * Names, not "the acting hero", because a kid answers to their name.
 */
export function tvStatus(view: TableView): string {
  const { prompt, party, connected, now } = view;
  const spec = prompt.spec;
  const lead = nameOf(party, leadOf(view));
  if (prompt.phase === "result") {
    return `${outcomeLine(prompt)} Tap "See what happens next" on any phone.`;
  }
  if (prompt.phase === "ready") {
    return `${lead}: tap "We're ready" on your phone when everyone is set.`;
  }
  switch (spec.kind) {
    case "precision":
      return `${lead}: watch the marker. Tap "${spec.actionLabel}" on your phone when it is in the gold.`;
    case "timing":
      return `${lead}: when the lamp says NOW!, tap "${spec.actionLabel}" on your phone.`;
    case "memory":
      return showing(view)
        ? "Everyone: watch the pattern and remember the order!"
        : `${lead}: tap the pictures on your phone in the same order, then "${spec.actionLabel}".`;
    case "tracking":
      return showing(view)
        ? "Everyone: keep your eyes on the glow while the covers shuffle!"
        : `${lead}: tap the cover where the glow ended, on your phone.`;
    case "sequence":
      return `Every phone has a clue. Read them out loud! Then ${lead} taps the steps in order.`;
    case "cooperate": {
      const ready = supportsReady(prompt, connected, new Date(now).toISOString());
      if (ready) return "Keep holding together. Watch it rise to the star!";
      const waiting = supportPlayers(prompt, connected).filter((id) => {
        const lease = prompt.supports[id];
        return lease !== null && !(typeof lease === "string" && Date.parse(lease) > now);
      }).map((id) => nameOf(party, id));
      return `${list(waiting)}: ${prompt.relaxed || connected.length === 1 ? "tap" : "press and hold"} "${spec.supportLabel}" on your phone. Everyone lifts together!`;
    }
    case "balance":
      return balanceReady(prompt, connected)
        ? "Level together!"
        : "Everyone lift a little. Lift higher or ease down to bring the shared marker into the gold.";
    case "relay": {
      const holder = relayHolder(prompt, connected);
      if (!holder) return "Delivered! It made it all the way.";
      const name = nameOf(party, holder);
      const next = relayHolder({ ...prompt, passed: [...(prompt.passed ?? []), holder] }, connected);
      const destination = next ? nameOf(party, next) : "home";
      return prompt.caughtBy === holder
        ? `${name}: slide ${spec.objectLabel} up to send it to ${destination}.`
        : `${name}: touch ${spec.objectLabel} on your phone to catch it!`;
    }
    case "play":
      return playReady(prompt, connected)
        ? `Everyone has joined in! ${lead}: tap "${spec.actionLabel}" on your phone.`
        : spec.participation === "everyone"
          ? "Everyone: pick something to do on your phone. Everyone gets a turn."
          : "Anyone: pick something to do on your phone.";
  }
}

export function outcomeLine(prompt: InteractionPrompt): string {
  return prompt.outcome === "success"
    ? "You did it together!"
    : prompt.outcome === "assisted"
      ? "A helping hand makes a way."
      : "A little twist in the adventure! Try once more, or carry on to see where it leads.";
}

export interface Job {
  /** What this phone's person does, in one line. */
  headline: string;
  /** How, in a sentence, or where to look. */
  detail?: string;
  /** Whether the thing to watch is on the TV or in this phone's hand. */
  lookAt: "tv" | "phone" | "both";
}

/** This phone's job: the line under the game's name on the controller. */
export function phoneJob(view: TableView, playerId: string): Job {
  const { prompt, party, connected, now } = view;
  const spec = prompt.spec;
  const leadId = leadOf(view);
  const mine = leadId === playerId;
  const lead = nameOf(party, leadId);
  if (prompt.phase === "result") {
    return { headline: outcomeLine(prompt), detail: "Tap below to see what happens next.", lookAt: "phone" };
  }
  if (prompt.phase === "ready") {
    return mine
      ? { headline: "You start this one.", detail: "Tap \"We're ready\" when everyone is looking at the TV.", lookAt: "phone" }
      : { headline: `${lead} starts this one.`, detail: "Look at the TV and get ready.", lookAt: "tv" };
  }
  switch (spec.kind) {
    case "precision":
      return mine
        ? { headline: "Tap when the marker is in the gold!", detail: `The marker slides back and forth. Tap "${spec.actionLabel}" when it is in the gold part. No rush, it keeps going.`, lookAt: "phone" }
        : { headline: `${lead} is aiming.`, detail: "Watch the TV and cheer them on!", lookAt: "tv" };
    case "timing":
      return mine
        ? { headline: "Wait for NOW!", detail: `The lamp says "Wait…" then "NOW!". Tap "${spec.actionLabel}" on NOW.`, lookAt: "phone" }
        : { headline: `${lead} is waiting for the moment.`, detail: "Watch the lamp on the TV and shout NOW when it lights up!", lookAt: "tv" };
    case "memory":
      if (showing(view)) return { headline: "Watch the TV!", detail: "Remember the order the pictures come in.", lookAt: "tv" };
      return mine
        ? { headline: "Tap the pictures in the same order.", detail: `Then tap "${spec.actionLabel}". Your friends can help you remember.`, lookAt: "phone" }
        : { headline: `Help ${lead} remember the order.`, detail: "Say it out loud!", lookAt: "tv" };
    case "tracking":
      if (showing(view)) return { headline: "Watch the TV!", detail: "See where the glow starts, then follow it while the covers shuffle.", lookAt: "tv" };
      return mine
        ? { headline: "Where did the glow end up?", detail: "Tap the cover. Ask your friends if you are not sure.", lookAt: "phone" }
        : { headline: `Help ${lead} pick the right cover.`, detail: "Where did you see it go?", lookAt: "tv" };
    case "sequence":
      return mine
        ? { headline: "Read your clue out loud, then tap the steps in order.", detail: `Everyone's phone has a different clue. When the order is right, tap "${spec.actionLabel}".`, lookAt: "phone" }
        : { headline: "Read your clue out loud!", detail: `${lead} taps the steps in order. Help them get it right.`, lookAt: "phone" };
    case "cooperate": {
      if (prompt.supports[playerId] === null) return { headline: "Your prop is holding!", detail: "Watch the lift. It finishes when everyone is helping.", lookAt: "both" };
      const ready = supportsReady(prompt, connected, new Date(now).toISOString());
      if (ready) return { headline: "Keep holding. Up it goes!", detail: "It finishes by itself at the star.", lookAt: "both" };
      return { headline: prompt.relaxed || connected.length === 1 ? "Tap to add your support." : "Press and hold together!", detail: "Everyone helps lift. Keep holding until it reaches the star.", lookAt: "phone" };
    }
    case "balance":
      return { headline: "Lift together. Find the gold!", detail: "Watch the shared marker. You can lift different amounts. It finishes when everyone is lifting and the marker reaches the gold.", lookAt: "both" };
    case "relay": {
      const holder = relayHolder(prompt, connected);
      if (!holder) return { headline: "It made it all the way!", detail: "Delivered together.", lookAt: "tv" };
      const next = relayHolder({ ...prompt, passed: [...(prompt.passed ?? []), holder] }, connected);
      const destination = next ? nameOf(party, next) : "home";
      if (holder === playerId) return prompt.caughtBy === playerId
        ? { headline: `Slide it up to ${destination}!`, detail: "The object follows your finger. Release to send it, or tap the object.", lookAt: "phone" }
        : { headline: "Catch it in your hands!", detail: "Touch the arriving object on your phone.", lookAt: "phone" };
      return prompt.passed?.includes(playerId)
        ? { headline: "You passed it. Nice!", detail: "Watch it travel to your friend on the TV.", lookAt: "tv" }
        : { headline: prompt.caughtBy === holder ? `${nameOf(party, holder)} has it. Your turn is coming.` : `It's arriving for ${nameOf(party, holder)}. Your turn is coming.`, detail: "Watch the object travel on the TV.", lookAt: "tv" };
    }
    case "play": {
      const done = prompt.contributions?.[playerId] !== undefined;
      const ready = playReady(prompt, connected);
      if (mine && ready) return { headline: "Everyone has joined in. Finish it!", detail: `Tap "${spec.actionLabel}".`, lookAt: "phone" };
      if (spec.stages?.length) return { headline: "Tap to make something happen.", detail: "Keep going and watch the TV.", lookAt: "both" };
      return done
        ? { headline: "You've joined in!", detail: spec.participation === "everyone" ? "Wait for everyone else, or pick again." : `${lead} finishes when everyone is done.`, lookAt: "tv" }
        : { headline: "Pick something to do.", detail: "Tap one. What happens shows on the TV.", lookAt: "phone" };
    }
  }
}

/** What "Take a helping hand" does, said once where the button is. */
export const HELPING_HAND = {
  summary: "Stuck? Get help",
  relaxed: "Easier mode: a bigger target, a slower pattern, and props that hold things for you.",
  hand: "A helping hand skips this game. Someone in the story lends a hand and the tale carries on. Nobody loses anything.",
} as const;

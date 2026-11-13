/**
 * A hero's own kit and look at the table (KIT_EDIT, LOOK_EDIT), shown the
 * moment she taps and sent behind her.
 *
 * These are the taps of the lobby's dressing-up: four kids trying colours at
 * once, as fast as they can tap. Sent the way an answer is (busy, wait for the
 * patch), each tap disabled every tile until its round trip came back, showed
 * nothing until the TV's patch reached the phone too, and named the revision
 * the phone last saw, so a second tap made before the first landed was refused
 * as stale. Here instead:
 *
 *   - **Shown at once.** What she picked is laid over the table's view of her
 *     kit or look (`withOwnEdits`) from the tap, and stays until the table's
 *     own view has caught up with it (her revision moved past the one it was
 *     sent on), or the send fails, when her pick gives way to what is stored.
 *   - **One in the air per hero and kind.** Taps made while one is on its way
 *     are merged (the latest pick of each field wins) and sent as one, once
 *     the table's view shows the first: so each send names the revision it was
 *     really made on, and nothing she tapped is refused as stale.
 *   - **Never blocking.** Nothing here holds the other buttons; the store's
 *     `send` is still what posts, catches up and says what went wrong.
 *
 * The server holds these to their revision, not the run's seq (handlers
 * action.ts `OWN_EDITS`), so other kids' taps landing first cost nothing.
 */

import { useSyncExternalStore } from "react";
import type { ClientIntent, RunState } from "@kad/shared";
import { useGameStore } from "./index";

export type OwnEditIntent = Extract<ClientIntent, { type: "KIT_EDIT" | "LOOK_EDIT" }>;
export type OwnEditKind = OwnEditIntent["type"];
/** The fields an edit changes: everything in it but who, what and on which revision. */
export type OwnEditFields = Record<string, unknown>;

interface Entry {
  kind: OwnEditKind;
  characterId: string;
  /** Tapped, not yet sent. */
  waiting: OwnEditFields;
  /** Sent and not yet shown by the table's view. */
  sent: OwnEditFields;
  /** The revision `sent` was made on; null while nothing is in the air. */
  sentOn: number | null;
  /** The send itself has answered ok, and only the table's view is awaited. */
  answered: boolean;
  /** Gives up waiting for the table's view, so a lost patch cannot hold her taps. */
  timer: ReturnType<typeof setTimeout> | null;
}

export interface OwnEditsDeps {
  send(intent: ClientIntent): Promise<boolean>;
  state(): RunState | null;
  /** Hear the mirror change. */
  subscribe(listener: () => void): () => void;
  /**
   * Bring the mirror forward from the server: asked when an answered send's patch has not
   * arrived within `settleMs`, so the next send can name the revision the server now holds.
   */
  catchUp?: () => void;
  /** How long an answered send waits for the table's view before asking for a catch-up. */
  settleMs?: number;
}

const EMPTY: OwnEditFields = Object.freeze({}) as OwnEditFields;

/** The revision the table's view of her kit or look is at, or null when it has none. */
export function ownRevision(state: RunState | null, kind: OwnEditKind, characterId: string): number | null {
  if (!state) return null;
  if (kind === "KIT_EDIT") return state.kits?.[characterId]?.revision ?? null;
  const member = state.party.find((m) => m.character.id === characterId);
  if (!member) return null;
  return member.character.look?.revision ?? 0;
}

function fieldsOf(intent: OwnEditIntent): OwnEditFields {
  const { type: _type, characterId: _id, revision: _revision, ...fields } = intent;
  return fields;
}

export function createOwnEdits(deps: OwnEditsDeps) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  /** What each hero's overlay is, as one frozen object per change, for useSyncExternalStore. */
  const shown = new Map<string, OwnEditFields>();
  const settleMs = deps.settleMs ?? 6_000;
  let unsubscribe: (() => void) | null = null;

  const keyOf = (kind: OwnEditKind, characterId: string): string => `${kind}:${characterId}`;

  function publish(entry: Entry): void {
    const key = keyOf(entry.kind, entry.characterId);
    const next = { ...entry.sent, ...entry.waiting };
    if (Object.keys(next).length === 0) {
      shown.delete(key);
      entries.delete(key);
    } else {
      shown.set(key, Object.freeze(next));
    }
    if (entries.size > 0 && unsubscribe === null) unsubscribe = deps.subscribe(onState);
    if (entries.size === 0 && unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    for (const listener of [...listeners]) listener();
  }

  function settle(entry: Entry): void {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.sent = {};
    entry.sentOn = null;
    entry.answered = false;
  }

  function flush(entry: Entry): void {
    if (entry.sentOn !== null || Object.keys(entry.waiting).length === 0) return;
    const revision = ownRevision(deps.state(), entry.kind, entry.characterId);
    if (revision === null) {
      // Her kit or look is not at this table any more: nothing to send it to.
      entry.waiting = {};
      publish(entry);
      return;
    }
    const fields = entry.waiting;
    entry.waiting = {};
    entry.sent = { ...entry.sent, ...fields };
    entry.sentOn = revision;
    entry.answered = false;
    const intent = { type: entry.kind, characterId: entry.characterId, revision, ...fields } as OwnEditIntent;
    publish(entry);
    deps.send(intent).then(
      (ok) => answered(entry, revision, ok),
      () => answered(entry, revision, false),
    );
  }

  function answered(entry: Entry, revision: number, ok: boolean): void {
    if (entry.sentOn !== revision) return;
    if (!ok) {
      // Refused or never landed: her pick gives way to what is stored (the store says why).
      settle(entry);
      publish(entry);
      flush(entry);
      return;
    }
    entry.answered = true;
    if (caughtUp(entry)) {
      settle(entry);
      publish(entry);
      flush(entry);
      return;
    }
    wait(entry, revision);
  }

  /**
   * The send landed but the table's view has not shown it: its patch is late or lost. The
   * revision the phone holds is the one the server already used, so sending what waits on it
   * would be refused as stale. Ask for a catch-up and keep waiting; `onState` sends what
   * waits once the view moves past `revision`.
   */
  function wait(entry: Entry, revision: number): void {
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.sentOn !== revision) return;
      if (caughtUp(entry)) {
        settle(entry);
        publish(entry);
        flush(entry);
        return;
      }
      deps.catchUp?.();
      wait(entry, revision);
    }, settleMs);
  }

  function caughtUp(entry: Entry): boolean {
    if (entry.sentOn === null) return false;
    const now = ownRevision(deps.state(), entry.kind, entry.characterId);
    return now === null || now > entry.sentOn;
  }

  function onState(): void {
    for (const entry of [...entries.values()]) {
      if (entry.sentOn !== null && entry.answered && caughtUp(entry)) {
        settle(entry);
        publish(entry);
        flush(entry);
      }
    }
  }

  return {
    /** Her tap: shown now, sent as soon as nothing of hers of this kind is in the air. */
    edit(intent: OwnEditIntent): void {
      const key = keyOf(intent.type, intent.characterId);
      let entry = entries.get(key);
      if (!entry) {
        entry = { kind: intent.type, characterId: intent.characterId, waiting: {}, sent: {}, sentOn: null, answered: false, timer: null };
        entries.set(key, entry);
      }
      entry.waiting = { ...entry.waiting, ...fieldsOf(intent) };
      publish(entry);
      flush(entry);
    },
    /** The fields laid over the table's view of her kit or look: the same object until it changes. */
    shown(kind: OwnEditKind, characterId: string): OwnEditFields {
      return shown.get(keyOf(kind, characterId)) ?? EMPTY;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type OwnEdits = ReturnType<typeof createOwnEdits>;

/** The table's view of her kit or look with what she has tapped and the table does not show yet. */
export function withOwnEdits<T extends object>(view: T, fields: OwnEditFields): T {
  if (fields === EMPTY || Object.keys(fields).length === 0) return view;
  const next = { ...view } as Record<string, unknown>;
  for (const [field, value] of Object.entries(fields)) {
    // A kit's buddy is absent for none; every other field is null for none.
    if (field === "buddy" && value === null) delete next[field];
    else next[field] = value;
  }
  return next as T;
}

let shared: OwnEdits | null = null;

/** This page's sender, over the game store. */
export function ownEdits(): OwnEdits {
  shared ??= createOwnEdits({
    send: (intent) => useGameStore.getState().send(intent),
    state: () => useGameStore.getState().state,
    subscribe: (listener) => useGameStore.subscribe(listener),
    catchUp: () => useGameStore.getState().reconnect(),
  });
  return shared;
}

/** Her overlay for one kind of edit, re-rendering only when it changes. */
export function useOwnEdits(kind: OwnEditKind, characterId: string): OwnEditFields {
  const edits = ownEdits();
  return useSyncExternalStore(edits.subscribe, () => edits.shown(kind, characterId), () => EMPTY);
}

/** Whether an intent is one of hers to show at once and send behind her. */
export function isOwnEdit(intent: ClientIntent): intent is OwnEditIntent {
  return intent.type === "KIT_EDIT" || intent.type === "LOOK_EDIT";
}

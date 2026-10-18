/**
 * The organizer's screen (#248): a grown-up running one household or several,
 * a family and a club, say, alone or with co-organizers.
 *
 * Its own store, for the reason the keepsake flow has one: this is local UI
 * state about an account, belongs to no run, and must never sit next to the
 * game store's patch-only mirror.
 *
 * The id token lives here, in memory, for as long as the panel is open and no
 * longer. Nothing is saved: an organizer is often on a phone or tablet the
 * kids will pick up next, and closing the panel has to leave nobody signed in.
 */

import { create } from "zustand";
import type { OrganizerHouseholdSummary, OrganizerHouseholdView, OrganizerInvite, PairingCode } from "@kad/shared";
import { api as defaultApi, type Api, type OrganizerEdit } from "../sync/client";

/** An edit, minus the household it applies to: always the one on screen. */
export type OrganizerChange = OrganizerEdit extends infer E
  ? E extends OrganizerEdit
    ? Omit<E, "householdId">
    : never
  : never;

export interface OrganizerStore {
  /** Who is signed in, for the header. `null` when the panel is not open. */
  email: string | null;
  households: OrganizerHouseholdSummary[];
  /** The household being managed. `null` is the picker. */
  view: OrganizerHouseholdView | null;
  /** The last code made for the household on screen, to read out or send. */
  invite: OrganizerInvite | null;
  /** The last pairing code made, and for which kid (#281). */
  pairing: { playerId: string; code: PairingCode } | null;
  busy: boolean;
  error: string | null;

  /** Signed in: load the households, and open the only one if there is just one. */
  begin(idToken: string, email: string): Promise<void>;
  /** Drop the token and everything shown. */
  end(): void;
  openHousehold(householdId: string): Promise<void>;
  /** Back to the picker, re-read. */
  backToList(): Promise<void>;
  createGroup(displayName: string): Promise<void>;
  acceptInvite(code: string): Promise<void>;
  edit(change: OrganizerChange): Promise<void>;
  makeInvite(): Promise<void>;
  /** "Play as Ada on another device": a one-time code for one kid of this household. */
  makePairing(playerId: string): Promise<void>;
  /** Take a co-organizer off; your own id is "leave this group". */
  removeOrganizer(ownerId: string): Promise<void>;
  dismissError(): void;
}

export function createOrganizerStore(api: Api = defaultApi) {
  let idToken: string | null = null;

  return create<OrganizerStore>()((set, get) => {
    /** One request at a time, with its failure said in the panel. */
    async function run(work: (token: string) => Promise<void>): Promise<void> {
      const token = idToken;
      if (!token) {
        set({ error: "Sign in again to manage this." });
        return;
      }
      set({ busy: true, error: null });
      try {
        await work(token);
        set({ busy: false });
      } catch (err) {
        set({ busy: false, error: err instanceof Error && err.message ? err.message : "That didn't work. Try again." });
      }
    }

    async function show(token: string, householdId: string): Promise<void> {
      const view = await api.viewHousehold(token, householdId);
      set({ view, invite: get().view?.id === householdId ? get().invite : null, pairing: null });
    }

    return {
      email: null,
      households: [],
      view: null,
      invite: null,
      pairing: null,
      busy: false,
      error: null,

      async begin(token, email) {
        idToken = token;
        set({ email, households: [], view: null, invite: null, pairing: null, error: null });
        await run(async (t) => {
          const { households } = await api.listHouseholds(t);
          set({ households });
          const only = households.length === 1 ? households[0] : undefined;
          if (only) await show(t, only.id);
        });
      },

      end() {
        idToken = null;
        set({ email: null, households: [], view: null, invite: null, pairing: null, busy: false, error: null });
      },

      async openHousehold(householdId) {
        await run((t) => show(t, householdId));
      },

      async backToList() {
        set({ view: null, invite: null, pairing: null });
        await run(async (t) => {
          set({ households: (await api.listHouseholds(t)).households });
        });
      },

      async createGroup(displayName) {
        await run(async (t) => {
          const group = await api.createGroup(t, displayName.trim());
          set({ households: [...get().households, group] });
          await show(t, group.id);
        });
      },

      async acceptInvite(code) {
        await run(async (t) => {
          const joined = await api.acceptOrganizerInvite(t, code);
          set({ households: [...get().households.filter((h) => h.id !== joined.id), joined] });
          await show(t, joined.id);
        });
      },

      async edit(change) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          const view = await api.editHousehold(t, { ...change, householdId } as OrganizerEdit);
          set({ view });
        });
      },

      async makeInvite() {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          set({ invite: await api.createOrganizerInvite(t, householdId) });
        });
      },

      async makePairing(playerId) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          set({ pairing: { playerId, code: await api.pairProfile(t, householdId, playerId) } });
        });
      },

      async removeOrganizer(ownerId) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          const { left } = await api.removeOrganizer(t, householdId, ownerId);
          if (left) {
            set({ view: null, invite: null, households: (await api.listHouseholds(t)).households });
          } else {
            await show(t, householdId);
          }
        });
      },

      dismissError() {
        set({ error: null });
      },
    };
  });
}

export const useOrganizerStore = createOrganizerStore();

/** "ABCDEFGH" → "ABCD-EFGH": four and four, easier to read out across a ward. */
export function formatPairingCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** "ABCDEFGHJK" → "ABCDE-FGHJK": easier to read out across a room. */
export function formatInviteCode(code: string): string {
  return code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

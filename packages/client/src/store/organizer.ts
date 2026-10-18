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
import type {
  OrganizerDevice,
  OrganizerHouseholdSummary,
  OrganizerHouseholdView,
  OrganizerInvite,
  TransferAccepted,
  TransferCode,
  PairingCode,
} from "@kad/shared";
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
  /** The shared tablets of the household on screen (#273), forgotten ones left out. */
  devices: OrganizerDevice[];
  /** The last code made for the household on screen, to read out or send. */
  invite: OrganizerInvite | null;
  /** The last move code made on this screen, to show as a QR (#251). */
  transfer: TransferCode | null;
  /** The kid who just moved in, to say so. */
  arrived: TransferAccepted | null;
  /** A move code that came in on the URL (`/?move=`), waiting for a sign-in. */
  pendingMove: string | null;
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
  /** A code that moves this kid, her heroes and her finds to another home. */
  makeTransfer(playerId: string): Promise<void>;
  /** Hide the move code: shown once, for the grown-up taking her home. */
  dismissTransfer(): void;
  /**
   * Redeem a move code: into the household on screen, or a brand-new home for
   * her from the picker. Either way, her new home is opened.
   */
  acceptTransfer(code: string): Promise<void>;
  /** Hold a code from the URL until the panel opens. */
  setPendingMove(code: string | null): void;
  /** "Play as Ada on another device": a one-time code for one kid of this household. */
  makePairing(playerId: string): Promise<void>;
  /** Forget one of the household's shared tablets; its next request is refused. */
  forgetDevice(deviceId: string): Promise<void>;
  /** Take a co-organizer off; your own id is "leave this group". */
  removeOrganizer(ownerId: string): Promise<void>;
  /** Delete the household on screen and everything in it (#252), then back to the picker. */
  deleteHousehold(): Promise<void>;
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
      const [view, { devices }] = await Promise.all([
        api.viewHousehold(token, householdId),
        api.listSharedDevices(token, householdId),
      ]);
      const same = get().view?.id === householdId;
      set({
        view,
        devices: devices.filter((d) => !d.revoked),
        invite: same ? get().invite : null,
        transfer: same ? get().transfer : null,
        pairing: null,
      });
    }

    return {
      email: null,
      households: [],
      view: null,
      devices: [],
      invite: null,
      transfer: null,
      arrived: null,
      pendingMove: null,
      pairing: null,
      busy: false,
      error: null,

      async begin(token, email) {
        idToken = token;
        set({
          email,
          households: [],
          view: null,
          devices: [],
          invite: null,
          transfer: null,
          arrived: null,
          pairing: null,
          error: null,
        });
        await run(async (t) => {
          const { households } = await api.listHouseholds(t);
          set({ households });
          const only = households.length === 1 ? households[0] : undefined;
          if (only) await show(t, only.id);
        });
      },

      end() {
        idToken = null;
        set({
          email: null,
          households: [],
          view: null,
          devices: [],
          invite: null,
          transfer: null,
          arrived: null,
          pendingMove: null,
          pairing: null,
          busy: false,
          error: null,
        });
      },

      async openHousehold(householdId) {
        await run((t) => show(t, householdId));
      },

      async backToList() {
        set({ view: null, devices: [], invite: null, transfer: null, arrived: null, pairing: null });
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

      async makeTransfer(playerId) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          set({ transfer: await api.createTransferCode(t, householdId, playerId) });
        });
      },

      dismissTransfer() {
        set({ transfer: null });
      },

      async acceptTransfer(code) {
        const into = get().view?.id;
        await run(async (t) => {
          const arrived = await api.acceptTransfer(t, code, into);
          const home = arrived.household;
          set({ arrived, pendingMove: null, households: [...get().households.filter((h) => h.id !== home.id), home] });
          await show(t, home.id);
        });
      },

      setPendingMove(code) {
        set({ pendingMove: code });
      },

      async makePairing(playerId) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          set({ pairing: { playerId, code: await api.pairProfile(t, householdId, playerId) } });
        });
      },

      async forgetDevice(deviceId) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          await api.forgetDeviceById(t, deviceId);
          await show(t, householdId);
        });
      },

      async removeOrganizer(ownerId) {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          const { left } = await api.removeOrganizer(t, householdId, ownerId);
          if (left) {
            set({ view: null, devices: [], invite: null, households: (await api.listHouseholds(t)).households });
          } else {
            await show(t, householdId);
          }
        });
      },

      async deleteHousehold() {
        const householdId = get().view?.id;
        if (!householdId) return;
        await run(async (t) => {
          const { households } = await api.deleteHousehold(t, householdId);
          set({ view: null, devices: [], invite: null, transfer: null, arrived: null, pairing: null, households });
        });
      },

      dismissError() {
        set({ error: null });
      },
    };
  });
}

export const useOrganizerStore = createOrganizerStore();

/** "ABCDEFGHJK" → "ABCDE-FGHJK": easier to read out across a room. */
export function formatInviteCode(code: string): string {
  return code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

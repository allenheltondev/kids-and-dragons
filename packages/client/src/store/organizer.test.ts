import { describe, expect, it, vi } from "vitest";
import type { OrganizerHouseholdView } from "@kad/shared";
import type { Api } from "../sync/client";
import { createOrganizerStore, formatInviteCode } from "./organizer";

function view(id: string, overrides: Partial<OrganizerHouseholdView> = {}): OrganizerHouseholdView {
  return {
    id,
    displayName: id === "h_club" ? "Thursday Club" : "Home",
    owners: [{ id: "sub_ana", email: "ana@example.com", you: true, founding: true }],
    players: [],
    ...overrides,
  };
}

function setup(households = [{ id: "h_club", displayName: "Thursday Club", players: 0 }]) {
  const api = {
    listHouseholds: vi.fn(async () => ({ households })),
    viewHousehold: vi.fn(async (_t: string, id: string) => view(id)),
    createGroup: vi.fn(async (_t: string, displayName: string) => ({ id: "h_new", displayName, players: 0 })),
    editHousehold: vi.fn(async (_t: string, edit: { householdId: string }) => view(edit.householdId, { displayName: "Renamed" })),
    createOrganizerInvite: vi.fn(async () => ({ code: "ABCDEFGHJK", expiresAt: "2026-07-07T18:00:00.000Z" })),
    acceptOrganizerInvite: vi.fn(async () => ({ id: "h_other", displayName: "Cousins", players: 3 })),
    removeOrganizer: vi.fn(async () => ({ householdId: "h_club", left: true })),
    createTransferCode: vi.fn(async (_t: string, _h: string, playerId: string) => ({
      code: "MOVEHERNOW",
      expiresAt: "2026-07-05T18:00:00.000Z",
      playerId,
      displayName: "Ada",
    })),
    acceptTransfer: vi.fn(async (_t: string, _code: string, householdId?: string) => ({
      household: { id: householdId ?? "h_ada", displayName: householdId ? "Thursday Club" : "Ada's household", players: 1 },
      playerId: "p_ada",
      displayName: "Ada",
      heroes: 2,
    })),
  };
  return { store: createOrganizerStore(api as unknown as Api), api };
}

describe("the organizer store", () => {
  it("opens the only household straight away", async () => {
    const { store, api } = setup();
    await store.getState().begin("id_tok", "ana@example.com");
    expect(api.viewHousehold).toHaveBeenCalledWith("id_tok", "h_club");
    expect(store.getState().view?.displayName).toBe("Thursday Club");
  });

  it("shows the picker when there is more than one", async () => {
    const { store, api } = setup([
      { id: "h_1", displayName: "Home", players: 2 },
      { id: "h_club", displayName: "Thursday Club", players: 5 },
    ]);
    await store.getState().begin("id_tok", "ana@example.com");
    expect(store.getState().view).toBeNull();
    expect(api.viewHousehold).not.toHaveBeenCalled();
    await store.getState().openHousehold("h_club");
    expect(store.getState().view?.id).toBe("h_club");
  });

  it("applies every edit to the household on screen", async () => {
    const { store, api } = setup();
    await store.getState().begin("id_tok", "ana@example.com");
    await store.getState().edit({ action: "add-player", displayName: "Posy" });
    expect(api.editHousehold).toHaveBeenCalledWith("id_tok", { action: "add-player", displayName: "Posy", householdId: "h_club" });
    expect(store.getState().view?.displayName).toBe("Renamed");
  });

  it("starts a group and joins one by code, opening each", async () => {
    const { store } = setup([]);
    await store.getState().begin("id_tok", "ana@example.com");
    await store.getState().createGroup("  Club  ");
    expect(store.getState().view?.id).toBe("h_new");
    await store.getState().acceptInvite("ABCDE-FGHJK");
    expect(store.getState().view?.id).toBe("h_other");
    expect(store.getState().households.map((h) => h.id)).toEqual(["h_new", "h_other"]);
  });

  it("makes a move code for one kid of the household on screen (#251)", async () => {
    const { store, api } = setup();
    await store.getState().begin("id_tok", "ana@example.com");
    await store.getState().makeTransfer("p_ada");
    expect(api.createTransferCode).toHaveBeenCalledWith("id_tok", "h_club", "p_ada");
    expect(store.getState().transfer).toMatchObject({ code: "MOVEHERNOW", displayName: "Ada" });
    store.getState().dismissTransfer();
    expect(store.getState().transfer).toBeNull();
  });

  it("takes a moving kid into a new home from the picker, and into the household on screen from there", async () => {
    const { store, api } = setup([]);
    await store.getState().begin("id_tok", "mum@example.com");
    store.getState().setPendingMove("MOVEHERNOW");
    await store.getState().acceptTransfer("MOVEH-ERNOW");
    expect(api.acceptTransfer).toHaveBeenLastCalledWith("id_tok", "MOVEH-ERNOW", undefined);
    expect(store.getState().view?.id).toBe("h_ada");
    expect(store.getState().arrived).toMatchObject({ displayName: "Ada", heroes: 2 });
    expect(store.getState().pendingMove).toBeNull();
    expect(store.getState().households.map((h) => h.id)).toEqual(["h_ada"]);

    await store.getState().openHousehold("h_club");
    await store.getState().acceptTransfer("OTHERKIDCD");
    expect(api.acceptTransfer).toHaveBeenLastCalledWith("id_tok", "OTHERKIDCD", "h_club");
  });

  it("goes back to the picker after leaving a group", async () => {
    const { store } = setup();
    await store.getState().begin("id_tok", "ana@example.com");
    await store.getState().makeInvite();
    expect(store.getState().invite?.code).toBe("ABCDEFGHJK");
    await store.getState().removeOrganizer("sub_ana");
    expect(store.getState().view).toBeNull();
    expect(store.getState().invite).toBeNull();
  });

  it("says what went wrong, and forgets the token on end", async () => {
    const { store, api } = setup();
    api.viewHousehold.mockRejectedValueOnce(new Error("that household belongs to a different account"));
    await store.getState().begin("id_tok", "ana@example.com");
    expect(store.getState().error).toBe("that household belongs to a different account");

    store.getState().end();
    await store.getState().openHousehold("h_club");
    expect(store.getState().error).toBe("Sign in again to manage this.");
  });

  it("splits a code for reading aloud", () => {
    expect(formatInviteCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
});

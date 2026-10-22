import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import committedItems from "../../../../content/items.json";
import { FACET_ICON_IDS } from "../assets/item-icons";

afterEach(() => vi.unstubAllGlobals());

it("loads distinct facet display icons without changing authored item definitions", async () => {
  const original = structuredClone(committedItems);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(committedItems)));
  const items = await api.loadItems();
  expect(Object.keys(items)).not.toContain("$comment");
  for (const id of FACET_ICON_IDS) {
    const authored = committedItems[id as keyof typeof committedItems];
    expect(items[id]).toEqual({ ...(authored as object), icon: id });
  }
  expect(items.sunbloom_draught).toEqual(committedItems.sunbloom_draught);
  expect(items.rusted_key).toEqual(committedItems.rusted_key);
  expect(committedItems).toEqual(original);
});

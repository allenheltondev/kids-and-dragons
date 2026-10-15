import { describe, expect, it } from "vitest";
import { atlasLevel, visibleMapPlaces, visibleMapRoutes } from "./atlas-math";
import type { WorldAtlas, WorldRoute } from "@kad/shared";
import type { WorldPlace } from "@kad/shared";

describe("regional atlas coordinates", () => {
  it("loads only the resolution required and caps at native detail", () => {
    const atlas: WorldAtlas = { image: { width: 2048, height: 2048 }, levels: [512, 1024, 2048].map((width) => ({ image: { width, height: width }, tiles: [] })) };
    expect(atlasLevel(atlas, 400).image.width).toBe(512);
    expect(atlasLevel(atlas, 800).image.width).toBe(1024);
    expect(atlasLevel(atlas, 9999).image.width).toBe(2048);
  });
  it("does not reveal a route's undiscovered settlement or crossing", () => {
    const forest: WorldPlace = { id: "biome.woods", title: "Woods", kind: "biome", anchor: { x: 1, y: 1 }, parent: null };
    const town: WorldPlace = { ...forest, id: "location.town", kind: "location" };
    const route: WorldRoute = { id: "route.path", title: "Path", connects: [forest.id, town.id], kind: "overland_route", travelModes: ["foot"], accuracy: "approximate", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] };
    expect(visibleMapRoutes([route], { forest, town }, new Set())).toEqual([]);
    expect(visibleMapRoutes([route], { forest, town }, new Set([town.id]))).toEqual([route]);
    expect(visibleMapRoutes([{ ...route, connects: [forest.id], via: town.id }], { forest, town }, new Set())).toEqual([]);
  });
  it("shows regions for orientation but requires discovery for specific sites", () => {
    const forest: WorldPlace = { id: "biome.woods", title: "Woods", kind: "biome", anchor: { x: 1, y: 1 }, parent: null };
    const town: WorldPlace = { ...forest, id: "location.town", title: "Town", kind: "location", parent: "woods" };
    expect(visibleMapPlaces({ forest, town }, new Set())).toEqual([forest]);
    expect(visibleMapPlaces({ forest, town }, new Set([town.id]))).toEqual([forest, town]);
  });
});

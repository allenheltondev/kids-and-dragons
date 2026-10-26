import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { BUILT_IN_ICON_IDS } from "../../../shared/src/icon-registry";
import { hasIcon } from "./icons";

describe("authored interaction icon registry", () => {
  it("accepts every registered painted icon and built-in Icon name", () => {
    const ids = [...manifest.paintedIcons.ids, ...BUILT_IN_ICON_IDS];
    expect(ids.filter((id) => !hasIcon(id))).toEqual([]);
  });
});

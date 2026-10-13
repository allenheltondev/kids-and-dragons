import { describe, expect, it } from "vitest";
import {
  FIELD_GUIDE_VERSION,
  StoredFieldGuideError,
  emptyFieldGuide,
  migrateFieldGuide,
} from "./field-guide-record.js";

describe("migrateFieldGuide", () => {
  it("reads an unstamped (v0) row and stamps the current version", () => {
    const book = migrateFieldGuide({
      entries: { moth: { firstFoundBy: "p_1", foundAt: "2026-07-04T18:00:00.000Z", runId: "r_1" } },
    });
    expect(book.v).toBe(FIELD_GUIDE_VERSION);
    expect(book.entries["moth"]).toEqual({
      firstFoundBy: "p_1",
      foundAt: "2026-07-04T18:00:00.000Z",
      runId: "r_1",
    });
  });
  it("defaults missing entries to an empty book", () => {
    expect(migrateFieldGuide({}, 1)).toEqual(emptyFieldGuide());
  });
  it("refuses a row from the future", () => {
    expect(() => migrateFieldGuide({ entries: {} }, FIELD_GUIDE_VERSION + 1)).toThrow(StoredFieldGuideError);
  });
  it("refuses an entry with no finder", () => {
    expect(() => migrateFieldGuide({ entries: { moth: { foundAt: "x" } } })).toThrow(StoredFieldGuideError);
  });
});

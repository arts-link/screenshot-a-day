import { describe, expect, it } from "vitest";
import {
  CAPTURES_PER_PAGE,
  changeComparisonSlot,
  emptyComparisonSelection,
  paginateCaptures,
  removeComparisonSlot,
  selectCapture,
  selectionRole,
  successfulCaptures,
  validComparisonPair,
  type ComparableCapture,
} from "./comparison-selection";

const capture = (
  id: string,
  capturedAt: string,
  status = "succeeded",
  profileId = "desktop",
): ComparableCapture => ({ id, capturedAt, status, profileId });

describe("comparison selection", () => {
  it("fills Earlier then Later and normalizes chronology", () => {
    const later = capture("later", "2026-08-02T00:00:00Z");
    const earlier = capture("earlier", "2026-08-01T00:00:00Z");
    const first = selectCapture(emptyComparisonSelection(), later);
    expect(first.active).toBe("later");
    const complete = selectCapture(first, earlier);
    expect(complete).toEqual({ earlier, later, active: null });
    expect(selectionRole(complete, "earlier")).toBe("earlier");
    expect(validComparisonPair(complete)).toEqual([earlier, later]);
  });

  it("replaces and removes the requested slot without accepting a third ambiguous selection", () => {
    const first = capture("first", "2026-08-01T00:00:00Z");
    const second = capture("second", "2026-08-02T00:00:00Z");
    const third = capture("third", "2026-08-03T00:00:00Z");
    const complete = selectCapture(selectCapture(emptyComparisonSelection(), first), second);
    expect(selectCapture(complete, third)).toBe(complete);
    const replaced = selectCapture(changeComparisonSlot(complete, "later"), third);
    expect(replaced.later).toBe(third);
    expect(removeComparisonSlot(replaced, "earlier")).toEqual({
      earlier: null,
      later: third,
      active: "earlier",
    });
    expect(validComparisonPair(removeComparisonSlot(replaced, "earlier"))).toBeNull();
  });

  it("clears both slots when the active profile changes", () => {
    const filled = selectCapture(
      selectCapture(emptyComparisonSelection(), capture("first", "2026-08-01T00:00:00Z")),
      capture("second", "2026-08-02T00:00:00Z"),
    );
    expect(validComparisonPair(filled)).not.toBeNull();
    const afterProfileChange = emptyComparisonSelection();
    expect(afterProfileChange).toEqual({ earlier: null, later: null, active: "earlier" });
    expect(validComparisonPair(afterProfileChange)).toBeNull();
  });

  it("filters failures, paginates by twelve, and rejects invalid pairs", () => {
    const captures = Array.from({ length: 26 }, (_, index) =>
      capture(String(index), `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
    );
    captures[3] = capture("failed", "2026-08-04T00:00:00Z", "failed");
    expect(CAPTURES_PER_PAGE).toBe(12);
    expect(successfulCaptures(captures)).toHaveLength(25);
    expect(paginateCaptures(successfulCaptures(captures), 0)).toHaveLength(12);
    expect(paginateCaptures(successfulCaptures(captures), 2)).toHaveLength(1);

    const mixed = {
      earlier: capture("one", "2026-08-01T00:00:00Z", "succeeded", "desktop"),
      later: capture("two", "2026-08-02T00:00:00Z", "succeeded", "mobile"),
      active: null,
    } as const;
    expect(validComparisonPair(mixed)).toBeNull();
  });
});

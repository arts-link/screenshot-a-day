export const CAPTURES_PER_PAGE = 12;

export type ComparisonSlot = "earlier" | "later";

export interface ComparableCapture {
  id: string;
  capturedAt: string;
  profileId: string;
  status: string;
}

export interface ComparisonSelection<T extends ComparableCapture = ComparableCapture> {
  earlier: T | null;
  later: T | null;
  active: ComparisonSlot | null;
}

export function emptyComparisonSelection<T extends ComparableCapture>(): ComparisonSelection<T> {
  return { earlier: null, later: null, active: "earlier" };
}

export function successfulCaptures<T extends ComparableCapture>(captures: T[]): T[] {
  return captures.filter((capture) => capture.status === "succeeded");
}

export function paginateCaptures<T>(
  captures: T[],
  page: number,
  pageSize = CAPTURES_PER_PAGE,
): T[] {
  const safePage = Math.max(0, page);
  return captures.slice(safePage * pageSize, (safePage + 1) * pageSize);
}

function chronological<T extends ComparableCapture>(first: T, second: T): [T, T] {
  return Date.parse(first.capturedAt) <= Date.parse(second.capturedAt)
    ? [first, second]
    : [second, first];
}

export function selectCapture<T extends ComparableCapture>(
  selection: ComparisonSelection<T>,
  capture: T,
): ComparisonSelection<T> {
  if (!selection.active) return selection;
  const replaced = { ...selection, [selection.active]: capture };
  if (replaced.earlier && replaced.later) {
    const [earlier, later] = chronological(replaced.earlier, replaced.later);
    return { earlier, later, active: null };
  }
  return {
    earlier: replaced.earlier,
    later: replaced.later,
    active: replaced.earlier ? "later" : "earlier",
  };
}

export function changeComparisonSlot<T extends ComparableCapture>(
  selection: ComparisonSelection<T>,
  active: ComparisonSlot,
): ComparisonSelection<T> {
  return { ...selection, active };
}

export function removeComparisonSlot<T extends ComparableCapture>(
  selection: ComparisonSelection<T>,
  slot: ComparisonSlot,
): ComparisonSelection<T> {
  return { ...selection, [slot]: null, active: slot };
}

export function selectionRole<T extends ComparableCapture>(
  selection: ComparisonSelection<T>,
  captureId: string,
): ComparisonSlot | null {
  if (selection.earlier?.id === captureId) return "earlier";
  if (selection.later?.id === captureId) return "later";
  return null;
}

export function validComparisonPair<T extends ComparableCapture>(
  selection: ComparisonSelection<T>,
): [T, T] | null {
  const { earlier, later } = selection;
  if (
    !earlier ||
    !later ||
    earlier.status !== "succeeded" ||
    later.status !== "succeeded" ||
    earlier.profileId !== later.profileId
  )
    return null;
  return [earlier, later];
}

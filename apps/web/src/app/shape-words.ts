/**
 * What an input looks like on the map, in words (#22): a point is a dot, a
 * line a dashed line, an area a dashed outline. Said by what the input
 * holds, rather than "the dashed outline" for a point too.
 */

/** How many of each an input holds. */
export interface ShapeKinds {
  readonly points: number;
  readonly lines: number;
  readonly areas: number;
}

export function shapeKinds(shapes: readonly { readonly type: string }[]): ShapeKinds {
  return {
    points: shapes.filter((shape) => shape.type === "Point").length,
    lines: shapes.filter((shape) => shape.type === "LineString").length,
    areas: shapes.filter((shape) => shape.type === "Polygon").length,
  };
}

function named(count: number, one: string, many: string): string[] {
  return count === 0 ? [] : [count === 1 ? one : many];
}

/** "Shown on the map as the dashed outline.", "… as the amber point.", and the like. */
export function onMapSentence(kinds: ShapeKinds): string {
  const parts = [
    ...named(kinds.points, "amber point", "amber points"),
    ...named(kinds.lines, "dashed line", "dashed lines"),
    ...named(kinds.areas, "dashed outline", "dashed outlines"),
  ];
  if (parts.length === 0) return "Shown on the map.";
  const last = parts.pop() ?? "";
  const list = parts.length === 0 ? last : `${parts.join(", ")} and ${last}`;
  return `Shown on the map as the ${list}.`;
}

/**
 * The legend's word for an input on the map: "point", "lines", "area"; just
 * "input" when it holds more than one kind.
 */
export function legendNoun(kinds: ShapeKinds): string {
  const present = [
    ...named(kinds.points, "point", "points"),
    ...named(kinds.lines, "line", "lines"),
    ...named(kinds.areas, "area", "areas"),
  ];
  return present.length === 1 ? (present[0] ?? "input") : "input";
}

/** Which swatch the legend shows for it: the one kind it holds, else an area's. */
export function legendKind(kinds: ShapeKinds): "point" | "line" | "area" {
  if (kinds.points > 0 && kinds.lines === 0 && kinds.areas === 0) return "point";
  if (kinds.lines > 0 && kinds.points === 0 && kinds.areas === 0) return "line";
  return "area";
}

/**
 * What both draw engines need from Terra Draw beyond drawing: telling their
 * own changes apart from the user's, and telling a shape apart from Terra
 * Draw's handles.
 *
 * ## Our changes are not the user's
 *
 * Terra Draw reports every change to its store the same way, whoever made it:
 * a user dragging a corner, or one of our own calls — `clear()`,
 * `addFeatures()`, `removeFeatures()`, `setMode()`, `selectFeature()`. It
 * reports them synchronously, inside the call (Terra Draw 1.35; pinned in the
 * engine tests, which run against the real library). An engine that forwards
 * what it hears therefore has to know which of its own calls is running, or it
 * hands its own bookkeeping to the form as though the user had drawn it. That
 * went wrong twice: a loaded file was emptied by the `clear()` that showed it
 * (#24), and a typed box was reverted by the `clear()` that deselected the old
 * one (review W15).
 *
 * `apply` marks a call as ours for exactly as long as it runs, and `finally`
 * unmarks it however the call ends, so a throw inside Terra Draw can never
 * leave the engine deaf to the user.
 */

import type { GeoJSONStoreFeatures } from "terra-draw";

export interface OwnChanges {
  /** Run `change` as ours: whatever Terra Draw reports while it runs is not the user's. */
  apply<T>(change: () => T): T;
  /** True while one of our own changes is running. */
  applying(): boolean;
}

export function createOwnChanges(): OwnChanges {
  // A count, not a flag, so that one of our changes may make another.
  let depth = 0;
  return {
    apply(change) {
      depth += 1;
      try {
        return change();
      } finally {
        depth -= 1;
      }
    },
    applying: () => depth > 0,
  };
}

/**
 * Terra Draw's own handles carry one of these, and share the `mode` of the
 * shape they belong to — so the mode alone does not tell them apart (Sam's
 * finding: a drawn triangle came out as one polygon and three points). Its own
 * `GUIDANCE_POINT_PROPERTY_KEYS` also lists `edited`, which is wrong here: that
 * one is set on real shapes when a user moves them.
 */
export const HANDLE_PROPERTIES = [
  "midPoint",
  "selectionPoint",
  "closingPoint",
  "snappingPoint",
  "coordinatePoint",
] as const;

/** A corner dot, a midpoint, a selection handle: Terra Draw's, not a shape. */
export function isHandle(feature: GeoJSONStoreFeatures): boolean {
  return HANDLE_PROPERTIES.some((key) => feature.properties[key] === true);
}

/**
 * The ids of the shapes drawn with one of `modes`, leaving out every handle.
 * Removing a shape takes its own handles with it, and Terra Draw throws on an
 * id it no longer has, so a list of ids to remove must be built from this and
 * never from the whole snapshot (review W1).
 */
export function shapeIds(
  features: readonly GeoJSONStoreFeatures[],
  modes: ReadonlySet<string>,
): (string | number)[] {
  return features.flatMap((feature) => {
    const { id } = feature;
    const mode = feature.properties["mode"];
    return id === undefined || isHandle(feature) || typeof mode !== "string" || !modes.has(mode)
      ? []
      : [id];
  });
}

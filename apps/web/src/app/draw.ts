/**
 * Which bounding-box field, if any, the map is drawing for.
 *
 * The map sits beside the form, not inside it, so a field cannot hand the map
 * its props directly. This context is the hand-over: a field asks to draw, the
 * app gives the map binding that field's value and change handler, and either
 * side can stop. Protocol knowledge stays on the field's side — the map binding
 * only ever sees four numbers in longitude-first order (T9).
 */

import { createContext } from "react";

export interface DrawTarget {
  /** The field being drawn for, or undefined when the map is only a map. */
  readonly fieldId: string | undefined;
  /** Whether the map can draw at all: a basemap exists and loaded. */
  readonly available: boolean;
  start(fieldId: string): void;
  stop(): void;
}

export const DrawContext = createContext<DrawTarget>({
  fieldId: undefined,
  available: false,
  start: () => undefined,
  stop: () => undefined,
});

/**
 * Which field drawing was started for, and in which opened form. The form is
 * held by identity: every time a process is opened it gets a fresh plan, so
 * reopening the same process does not resume an old drawing.
 */
export interface DrawRequest {
  readonly form: object;
  readonly fieldId: string;
}

/**
 * The field the map draws for now: the requested one, but only while the form
 * it was requested in is still the one open. Choosing another process — or
 * leaving the form to run — therefore ends drawing without anything having to
 * notice the change (T9).
 */
export function activeDrawField(
  request: DrawRequest | undefined,
  openForm: object | undefined,
): string | undefined {
  return request !== undefined && request.form === openForm ? request.fieldId : undefined;
}

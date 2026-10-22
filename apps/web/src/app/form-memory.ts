/**
 * Each process's form, kept for the visit (#10): what was typed, chosen or
 * drawn in a process's form comes back when the process is opened again,
 * after the list, Back, Start, or another service and back. It never asks
 * "Leave?": nothing is lost by leaving.
 *
 * In memory only, keyed by the service's address and the process id: never
 * stored, so a reload starts every form afresh (and the browser asks before
 * a reload throws typed values away; `address.ts`). The same service reached
 * directly or through the relay is one service: its forms are the same.
 */

import type { FormValues } from "../forms/encode.js";
import type { FormPlan } from "../forms/plan.js";

/** The forms kept this visit, by {@link formKey}. */
export type FormMemory = ReadonlyMap<string, FormValues>;

/** The key a process's form is kept under: the service's address without its trailing slashes, and the process id. */
export function formKey(baseUrl: string, processId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}\n${processId}`;
}

/** Whether two field values are the same: form values are plain data. */
function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/** Whether a form holds only what it started with: nothing typed, chosen or drawn. */
export function isUntouched(values: FormValues, initial: FormValues): boolean {
  const ids = new Set([...Object.keys(values), ...Object.keys(initial)]);
  return [...ids].every((id) => sameValue(values[id], initial[id]));
}

/**
 * The memory with this form in it, or without it when it holds only what it
 * started with: an untouched form is nothing to bring back.
 */
export function remember(
  memory: FormMemory,
  key: string,
  values: FormValues,
  initial: FormValues,
): FormMemory {
  const next = new Map(memory);
  if (isUntouched(values, initial)) next.delete(key);
  else next.set(key, values);
  return next;
}

/**
 * The values a form opens with: what it starts with, and over that what was
 * kept for it, for the inputs the description still has.
 */
export function restoredValues(
  plan: FormPlan,
  initial: FormValues,
  kept: FormValues | undefined,
): FormValues {
  if (kept === undefined) return initial;
  return Object.fromEntries(
    plan.fields.map((field) => [
      field.id,
      Object.hasOwn(kept, field.id) ? kept[field.id] : initial[field.id],
    ]),
  );
}

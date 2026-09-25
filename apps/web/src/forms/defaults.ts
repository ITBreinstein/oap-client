/**
 * The values a freshly generated form starts with.
 *
 * A **required** field starts at its schema `default`, when it has one, so the
 * user sees a value that will be sent. An **optional** field starts empty even
 * when it has a default, and is left out of the request: the default is the
 * server's to apply, and sending it back explicitly would turn "whatever the
 * server does by default" into "what the client read in the description",
 * which are not always the same thing. The renderer shows the default as a
 * hint instead.
 *
 * Booleans follow the same rule, and it is why an optional boolean has three
 * states — not set, yes, no — rather than a checkbox (R9). 462 of ZOO's 516
 * boolean inputs are optional, 181 of them default to `true`, and Z5 found that
 * neither server validates: a checkbox left unticked would silently send
 * `false` over the server's `true`.
 */

import type { ComplexValue, FormValues } from "./encode.js";
import type { Control, FormPlan } from "./plan.js";

export function initialValue(control: Control, required: boolean): unknown {
  switch (control.kind) {
    case "text":
      return required ? (control.default ?? "") : "";
    case "number":
      return required && control.default !== undefined ? String(control.default) : "";
    case "select":
      return required ? control.default : undefined;
    case "checkbox":
      return required ? (control.default ?? false) : undefined;
    case "complex": {
      const value: ComplexValue = { format: 0 };
      return value;
    }
    case "list":
      // One empty row to start from; the encoder drops empty rows.
      return [initialValue(control.item, true)];
    case "bbox":
    case "geometry":
    case "json":
      return undefined;
  }
}

export function initialValues(plan: FormPlan): FormValues {
  return Object.fromEntries(
    plan.fields.map((field) => [field.id, initialValue(field.control, field.required)]),
  );
}

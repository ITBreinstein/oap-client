/**
 * Warnings, per field, where a value is not what its input's schema asks for
 * (package 6, finding 0054). Shown beside the field; never a reason to stop a
 * run. The blocking checks are `validate.ts`, and this is not them.
 *
 * What is checked is what will be sent: the form values encoded as the
 * request will carry them, though with each number as JavaScript holds it
 * (W28), with a qualified value's `value` taken out of its wrapper, and a
 * reference skipped — the server fetches that, and only it can say what is
 * behind it. An input that takes several values is checked value by value,
 * since its schema describes one.
 *
 * Where the check cannot run — a `$ref`, a pattern this browser cannot
 * compile, a value too large to walk — nothing is guessed: the input is
 * listed in `notChecked`, for the caller to record as a `form` observation.
 */

import type { ProcessDescription } from "@breinstein/oap-client";
import { toExecuteBody, type FormValues } from "./encode.js";
import { isJsonArray, isJsonObject } from "./json.js";
import type { FormPlan } from "./plan.js";
import { checkAgainstSchema } from "./schema-check.js";

export interface SchemaWarnings {
  /** By field id: what the schema asks for that the value is not. */
  readonly byField: ReadonlyMap<string, readonly string[]>;
  /** Inputs holding a value the check could not run on, and the keyword that stopped it. */
  readonly notChecked: readonly { readonly inputId: string; readonly keyword: string }[];
}

/** Whether the schema itself describes an object with a `value` member. */
function describesValueMember(schema: unknown): boolean {
  if (!isJsonObject(schema)) return false;
  const properties = schema["properties"];
  return isJsonObject(properties) && Object.hasOwn(properties, "value");
}

/** What the schema is about: the value itself, or `undefined` for a reference. */
function subject(sent: unknown, schema: unknown): { readonly value: unknown } | undefined {
  if (!isJsonObject(sent)) return { value: sent };
  if (typeof sent["href"] === "string") return undefined;
  if (Object.hasOwn(sent, "value") && !describesValueMember(schema))
    return { value: sent["value"] };
  return { value: sent };
}

export function schemaWarnings(
  process: ProcessDescription,
  plan: FormPlan,
  values: FormValues,
): SchemaWarnings {
  // A number kept as written for the wire is not a number to the check.
  const { inputs } = toExecuteBody(plan, values, { exact: false });
  const byField = new Map<string, readonly string[]>();
  const notChecked: { inputId: string; keyword: string }[] = [];

  for (const input of process.inputs) {
    if (!Object.hasOwn(inputs, input.id)) continue;
    const sent = inputs[input.id];
    const several = input.multiple && isJsonArray(sent);
    const items: readonly unknown[] = several ? sent : [sent];
    const problems: string[] = [];
    let stopped: string | undefined;

    items.forEach((item, index) => {
      if (stopped !== undefined) return;
      const about = subject(item, input.schema);
      if (about === undefined) return;
      const check = checkAgainstSchema(input.schema, about.value);
      if (check.kind === "not-checked") {
        stopped = check.keyword;
        return;
      }
      const prefix = several ? `Value ${String(index + 1)}: ` : "";
      problems.push(...check.problems.map((problem) => `${prefix}${problem}`));
    });

    if (stopped !== undefined) notChecked.push({ inputId: input.id, keyword: stopped });
    else if (problems.length > 0) byField.set(input.id, problems);
  }
  return { byField, notChecked };
}

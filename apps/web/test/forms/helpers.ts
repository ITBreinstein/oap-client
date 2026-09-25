/**
 * Shared helpers for the form-layer tests.
 *
 * The prototype's tests handed `resolveFormPlan` a raw document. The port takes
 * the core's parsed `ProcessDescription` (T2), so these helpers run a raw
 * document through the core's own `parseDescription` first: the tests then see
 * exactly what the app sees, cardinality normalised and all.
 */

import {
  parseDescription,
  type InputDescription,
  type ProcessDescription,
} from "@breinstein/oap-client";
import type { Control, FieldPlan, FormPlan } from "../../src/forms/plan.js";
import { resolveFormPlan } from "../../src/forms/resolve.js";

const DOCUMENT_URL = "https://example.org/processes/demo";

export function describeProcess(inputs: unknown, id = "demo"): ProcessDescription {
  return parseDescription({ id, inputs }, { documentUrl: DOCUMENT_URL }).process;
}

/**
 * A description built by hand, bypassing the core's parser — for the cases the
 * parser would never produce: a cyclic schema, or a `required` flag that
 * disagrees with `minOccurs`.
 */
export function handBuiltProcess(
  input: Partial<InputDescription> & { id: string },
): ProcessDescription {
  return {
    id: "hand-built",
    execution: { sync: true, async: false, dismiss: false, declared: [], defaulted: true },
    outputTransmission: [],
    links: [],
    inputs: [
      {
        minOccurs: 1,
        maxOccurs: 1,
        required: true,
        multiple: false,
        schema: {},
        ...input,
      },
    ],
    outputs: [],
  };
}

export function planFor(inputs: Record<string, unknown>, id = "demo"): FormPlan {
  return resolveFormPlan(describeProcess(inputs, id));
}

export function fieldFor(schema: unknown, extra: Record<string, unknown> = {}): FieldPlan {
  const [field] = planFor({ subject: { schema, ...extra } }).fields;
  if (field === undefined) throw new Error("the resolver produced no field");
  return field;
}

export function controlFor(schema: unknown, extra: Record<string, unknown> = {}): Control {
  return fieldFor(schema, extra).control;
}

/**
 * Every committed process description, keyed by `server/id`. Read with Vite's
 * glob import so the fixtures stay where the core's contract tests keep them.
 */
export const FIXTURE_DESCRIPTIONS: Readonly<Record<string, unknown>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<unknown>("../../../../packages/core/test/fixtures/*/processes/*.json", {
      eager: true,
      import: "default",
    }),
  ).map(([path, document]) => {
    const [, server = "", file = ""] = /fixtures\/([^/]+)\/processes\/(.+)\.json$/.exec(path) ?? [];
    return [`${server}/${file}`, document];
  }),
);

export function fixtureProcess(key: string): ProcessDescription {
  const document = FIXTURE_DESCRIPTIONS[key];
  if (document === undefined) throw new Error(`no fixture ${key}`);
  return parseDescription(document, { documentUrl: DOCUMENT_URL }).process;
}

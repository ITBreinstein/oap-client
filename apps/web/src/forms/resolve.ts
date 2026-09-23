/**
 * Turns a process description into a {@link FormPlan}.
 *
 * Takes the core's parsed `ProcessDescription`, not the raw document (T2). The
 * core has already decided what a malformed `minOccurs` means, which inputs are
 * required and which repeat; re-deriving any of that here would be a second
 * answer to a question the core owns, and the two would drift. So `required`
 * and `multiple` are read, never computed.
 *
 * What stays `unknown` is each input's `schema` — the core passes it through
 * untouched, by design — and the "never throws" guarantee is about that: a
 * schema fragment this resolver cannot read becomes a JSON editor and a
 * diagnostic, never an exception.
 */

import type { InputDescription, ProcessDescription } from "@breinstein/oap-client";
import { isJsonObject } from "./json.js";
import { fallbackControl, type MatchContext, MATCHERS } from "./matchers.js";
import type { Control, Diagnostic, DiagnosticCode, FieldPlan, FormPlan } from "./plan.js";

type Report = (code: DiagnosticCode, message: string, keyword?: string) => void;

/** Guards against a self-referential `items` chain from a hostile document. */
const MAX_NESTING = 5;

function resolveControl(schema: unknown, depth: number, report: Report): Control {
  if (schema === undefined) {
    const reason = "the schema fragment is missing";
    report("missing-schema", reason);
    return { kind: "json", reason };
  }
  if (!isJsonObject(schema)) {
    const reason = "the schema fragment is not an object";
    report("missing-schema", reason);
    return { kind: "json", reason, schema };
  }
  if (depth > MAX_NESTING) {
    const reason = `the schema nests deeper than ${String(MAX_NESTING)} levels`;
    report("unsupported-type", reason, "items");
    return { kind: "json", reason, schema };
  }

  const ctx: MatchContext = {
    report,
    nested: (inner: unknown) => resolveControl(inner, depth + 1, report),
  };
  for (const matcher of MATCHERS) {
    const control = matcher(schema, ctx);
    if (control !== undefined) return control;
  }
  return fallbackControl(schema, ctx);
}

/**
 * `multiple` wraps the control in a list — including a control that is
 * already a list (R10). `execute.yaml` allows each occurrence of an input to
 * be an array, so an array input that also repeats is a list of lists; the
 * prototype collapsed the two, and sent `[1, 2, 3]` where the server was owed
 * `[[1, 2], [3]]`. No description in the testbed has one today.
 */
function applyOccurrence(control: Control, input: InputDescription): Control {
  if (!input.multiple) return control;
  return {
    kind: "list",
    item: control,
    minItems: input.minOccurs > 0 ? input.minOccurs : undefined,
    maxItems: input.maxOccurs === "unbounded" ? undefined : input.maxOccurs,
  };
}

function readContentMediaType(schema: unknown): string | undefined {
  if (!isJsonObject(schema)) return undefined;
  const value = schema["contentMediaType"];
  return typeof value === "string" ? value : undefined;
}

function resolveField(input: InputDescription, report: Report): FieldPlan {
  const control = applyOccurrence(resolveControl(input.schema, 0, report), input);
  return {
    id: input.id,
    title: input.title ?? input.id,
    description: input.description,
    required: input.required,
    control,
    mediaType: readContentMediaType(input.schema),
  };
}

export function resolveFormPlan(process: ProcessDescription): FormPlan {
  const diagnostics: Diagnostic[] = [];
  const reporterFor =
    (inputId: string): Report =>
    (code, message, keyword) => {
      diagnostics.push({ inputId, code, message, ...(keyword === undefined ? {} : { keyword }) });
    };

  // Field order is the server's; the core keeps it in an array for exactly this.
  const fields = process.inputs.map((input) => resolveField(input, reporterFor(input.id)));
  return { processId: process.id, fields, diagnostics };
}

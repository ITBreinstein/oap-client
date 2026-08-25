/**
 * Turns a process description into a {@link FormPlan}.
 *
 * The argument is `unknown` on purpose: it is whatever the server returned, and
 * this function's job is to stay useful when that is not what the spec
 * describes. Nothing here throws — an input it cannot read becomes a JSON
 * editor and a diagnostic.
 */

import { isJsonObject, type JsonObject, readNumber, readObject, readString } from "./json.js";
import { fallbackControl, type MatchContext, MATCHERS } from "./matchers.js";
import type { Control, Diagnostic, DiagnosticCode, FieldPlan, FormPlan } from "./plan.js";

type Report = (code: DiagnosticCode, message: string) => void;

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
    report("unsupported-type", reason);
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

/** `maxOccurs` defaults to 1; the spec also allows the string `"unbounded"`. */
function readMaxOccurs(input: JsonObject): number | "unbounded" {
  const numeric = readNumber(input, "maxOccurs");
  if (numeric !== undefined) return numeric;
  return readString(input, "maxOccurs") === "unbounded" ? "unbounded" : 1;
}

/**
 * `maxOccurs > 1` and `type: "array"` are unrelated ways for a server to say
 * "more than one". Both end up as a list so the renderer needs one repeated
 * component. A schema that is already an array is left alone: an array
 * repeated is an array of arrays, and no server in the testbed means that.
 */
function applyOccurrence(
  control: Control,
  minOccurs: number,
  maxOccurs: number | "unbounded",
): Control {
  const repeatable = maxOccurs === "unbounded" || maxOccurs > 1;
  if (!repeatable || control.kind === "list") return control;

  return {
    kind: "list",
    item: control,
    minItems: minOccurs > 0 ? minOccurs : undefined,
    maxItems: maxOccurs === "unbounded" ? undefined : maxOccurs,
  };
}

function resolveField(id: string, input: unknown, report: Report): FieldPlan {
  if (!isJsonObject(input)) {
    const reason = "the input description is not an object";
    report("malformed-description", reason);
    return { id, title: id, required: false, control: { kind: "json", reason, schema: input } };
  }

  const minOccurs = readNumber(input, "minOccurs") ?? 1;
  const schema = input["schema"];
  const control = applyOccurrence(
    resolveControl(schema, 0, report),
    minOccurs,
    readMaxOccurs(input),
  );

  return {
    id,
    title: readString(input, "title") ?? id,
    description: readString(input, "description"),
    required: minOccurs >= 1,
    control,
    mediaType: isJsonObject(schema) ? readString(schema, "contentMediaType") : undefined,
  };
}

export function resolveFormPlan(description: unknown): FormPlan {
  const diagnostics: Diagnostic[] = [];
  const reporterFor =
    (inputId: string): Report =>
    (code, message) => {
      diagnostics.push({ inputId, code, message });
    };

  if (!isJsonObject(description)) {
    diagnostics.push({
      code: "malformed-description",
      message: "the process description is not an object",
    });
    return { fields: [], diagnostics };
  }

  const processId = readString(description, "id");
  const inputs = readObject(description, "inputs");
  if (inputs === undefined) {
    // A process with no inputs is legitimate; an `inputs` of the wrong shape is not.
    if ("inputs" in description) {
      diagnostics.push({
        code: "malformed-description",
        message: "`inputs` is present but is not an object",
      });
    }
    return { processId, fields: [], diagnostics };
  }

  // Field order is the server's; the spec gives no other ordering.
  const fields = Object.entries(inputs).map(([id, input]) =>
    resolveField(id, input, reporterFor(id)),
  );
  return { processId, fields, diagnostics };
}

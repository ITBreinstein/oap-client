import { type ProcessDescription, parseDescription } from "@breinstein/oap-client";
import bgtDescription from "../fixtures/forms/bgt-numeric-ranges/description.json?raw";
import bgtRequest from "../fixtures/forms/bgt-numeric-ranges/execute.request.json?raw";
import directedDescription from "../fixtures/forms/directed-undocumented-array/description.json?raw";
import directedRequest from "../fixtures/forms/directed-undocumented-array/execute.request.json?raw";
import csvDescription from "../fixtures/forms/zoo-inline-csv/description.json?raw";
import csvRequest from "../fixtures/forms/zoo-inline-csv/execute.request.json?raw";
import polygonsDescription from "../fixtures/forms/zoo-inline-geojson-polygons/description.json?raw";
import polygonsRequest from "../fixtures/forms/zoo-inline-geojson-polygons/execute.request.json?raw";
import lasDescription from "../fixtures/forms/zoo-inline-las/description.json?raw";
import lasRequest from "../fixtures/forms/zoo-inline-las/execute.request.json?raw";
import gmlDescription from "../fixtures/forms/zoo-linked-gml/description.json?raw";
import gmlRequest from "../fixtures/forms/zoo-linked-gml/execute.request.json?raw";

/**
 * The captured description/request pairs, loaded the way the app loads a live
 * one.
 *
 * Descriptions go through the core's own `parseDescription` rather than being
 * cast to a convenient interface: a fixture test that runs against a shape the
 * running app never sees is worse than no test at all.
 *
 * See `../fixtures/forms/README.md` for where these came from.
 */

const captured = {
  "bgt-numeric-ranges": { description: bgtDescription, request: bgtRequest },
  "directed-undocumented-array": { description: directedDescription, request: directedRequest },
  "zoo-inline-csv": { description: csvDescription, request: csvRequest },
  "zoo-inline-geojson-polygons": { description: polygonsDescription, request: polygonsRequest },
  "zoo-inline-las": { description: lasDescription, request: lasRequest },
  "zoo-linked-gml": { description: gmlDescription, request: gmlRequest },
} as const;

export type CapturedFormName = keyof typeof captured;

export const capturedFormNames = Object.keys(captured) as readonly CapturedFormName[];

interface CaptureEnvelope {
  readonly final_url?: string;
  readonly body: unknown;
}

function envelope(raw: string): CaptureEnvelope {
  return JSON.parse(raw) as CaptureEnvelope;
}

export function capturedDescription(name: CapturedFormName): ProcessDescription {
  const { final_url: finalUrl, body } = envelope(captured[name].description);
  return parseDescription(body, {
    // The captures write `{{baseUrl}}`, which is not a URL. Links resolve
    // against this, and nothing here fetches, so any absolute base will do.
    documentUrl: (finalUrl ?? "").replace("{{baseUrl}}", "http://localhost/ogc-api"),
  }).process;
}

/** The whole execute body the server accepted: `inputs`, and often more. */
export function capturedRequestBody(name: CapturedFormName): Record<string, unknown> {
  return envelope(captured[name].request).body as Record<string, unknown>;
}

export function capturedInputs(name: CapturedFormName): Record<string, unknown> {
  return capturedRequestBody(name)["inputs"] as Record<string, unknown>;
}

/**
 * ZOO's nested `format` rewritten as the standard OGC form, so a capture can be
 * compared against what we emit.
 *
 * Both spellings reach the same internal state in the ZOO kernel — its field
 * table folds `mediaType` and `contentMediaType` onto one `mimeType` — and a
 * live run against the pinned deployment returns byte-identical results for
 * each. We emit the standard one; the captures record the nested one.
 *
 * Narrow on purpose: it hoists the members of a `format` object and touches
 * nothing else. A normaliser that reshaped more would make every assertion in
 * the suite pass for free, which is why it has its own test.
 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;

  const result: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "format" &&
      typeof member === "object" &&
      member !== null &&
      !Array.isArray(member)
    ) {
      for (const [name, setting] of Object.entries(member as Record<string, unknown>)) {
        result[name] = setting;
      }
      continue;
    }
    result[key] = canonical(member);
  }
  return result;
}

/** The captured inputs, canonicalised, restricted to the ids a test supplies. */
export function expectedInputs(
  name: CapturedFormName,
  ids: readonly string[],
): Record<string, unknown> {
  const inputs = capturedInputs(name);
  return Object.fromEntries(
    ids.filter((id) => id in inputs).map((id) => [id, canonical(inputs[id])]),
  );
}

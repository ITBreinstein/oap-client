import { type ExecuteOptions, type ProcessDescription, checkArity } from "@breinstein/oap-client";
import { type InputEncodings, encodeInputs } from "./encode-inputs.js";

/**
 * The whole execute request body, assembled.
 *
 * The core copies what it is given and synthesises nothing — `buildPayload`
 * omits `inputs`, `outputs` and `response` unless the caller supplies them — so
 * every member below is a decision made here.
 */

export interface RunSettings {
  readonly response: "document" | "raw";
  readonly mode: "sync" | "async";
  readonly encodings?: InputEncodings;
}

/**
 * `"document"` because 29 of 33 captured requests say so and none say `"raw"`;
 * `"sync"` because polling does not exist yet.
 */
export const DEFAULT_RUN_SETTINGS: RunSettings = { response: "document", mode: "sync" };

/**
 * An empty selection for every output the process declares.
 *
 * Not cosmetic: ZOO answers a body carrying only `inputs` with
 * `400 InvalidParameterValue`, "ZOO-Kernel cannot parse your POST data", and
 * starts working the moment any `outputs` member is present. The core's own
 * interop tests send `{ <id>: {} }` for the same reason.
 *
 * Empty objects rather than the captures' `{ format, transmissionMode }`:
 * choosing an output format is a later job, and `{}` asks for the server's
 * default rather than asserting a preference we have no basis for.
 */
export function requestedOutputs(
  description: ProcessDescription,
): Readonly<Record<string, Record<string, never>>> {
  return Object.fromEntries(description.outputs.map((output) => [output.id, {}]));
}

export interface ExecutePlan {
  /** Hand straight to `execute(processesUrl, processId, plan.options)`. */
  readonly options: ExecuteOptions;
  /** Arity disagreements and encoder notes. Advisory — never blocks a run. */
  readonly warnings: readonly string[];
  /** Declared inputs the form held nothing for. */
  readonly omitted: readonly string[];
}

/**
 * Everything needed to run a process, from the form's current state.
 *
 * Pure and cheap, so a caller can build it on every render to show what would
 * be sent before anything is sent.
 */
export function buildExecutePlan(
  description: ProcessDescription,
  values: Readonly<Record<string, unknown>>,
  settings: RunSettings = DEFAULT_RUN_SETTINGS,
): ExecutePlan {
  const encoded = encodeInputs(description.inputs, values, {
    ...(settings.encodings === undefined ? {} : { encodings: settings.encodings }),
  });

  const outputs = requestedOutputs(description);

  const options: ExecuteOptions = {
    inputs: encoded.inputs,
    ...(Object.keys(outputs).length === 0 ? {} : { outputs }),
    response: settings.response,
    mode: settings.mode,
    // Lets the core prefer the description's advertised `execute` link over a
    // path it would otherwise have to construct.
    description,
  };

  return {
    options,
    warnings: [...checkArity(description, encoded.inputs), ...encoded.notes],
    omitted: encoded.omitted,
  };
}

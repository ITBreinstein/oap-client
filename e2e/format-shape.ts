/**
 * #F3, item 5 of the brief's §13: asking for a format must not change the
 * shape of the answer. Run in Node by three lanes — pygeoapi (blocking), ZOO
 * (zoo) and Weaver (weaver) — against the live server, with the web app's own
 * request building: the same `outputSelection` the form uses, once as today
 * (no format) and once with the formats `formatsToAsk` chooses, both through
 * the core's `client.execute()`, so either version's rules apply.
 *
 * "Shape" is what the request decides, not what the bytes say: whether the
 * answer is one output's value or an object keyed by output ids, and which
 * outputs that object holds. The media type is expected to differ — that is
 * the point of asking.
 */

import {
  createClient,
  ProcessesError,
  type Execution,
  type FetchLike,
  type ProcessDescription,
} from "../packages/core/src/index.js";
import { outputSelection } from "../apps/web/src/app/run.js";
import { formatsToAsk, type FormatChoices } from "../apps/web/src/results/format-choice.js";

export interface AnswerShape {
  /** `refused`: the server answered with an error status, kept as the evidence it is. */
  readonly kind: Execution["kind"] | "refused";
  readonly status: number | undefined;
  /** `document`: a JSON object keyed by output ids. `raw`: anything else. */
  readonly form: "document" | "raw" | "job";
  /** The output ids a document holds, sorted; empty for a raw answer. */
  readonly outputs: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function shapeOf(execution: Execution, outputIds: readonly string[]): Promise<AnswerShape> {
  if (execution.kind === "job") return { kind: "job", status: undefined, form: "job", outputs: [] };
  const { response } = execution;
  let body: unknown;
  if (response.isJson) {
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
  }
  const keys = isRecord(body) ? Object.keys(body) : [];
  const document = keys.length > 0 && keys.every((key) => outputIds.includes(key));
  return {
    kind: "immediate",
    status: response.status,
    form: document ? "document" : "raw",
    outputs: document ? [...keys].sort() : [],
  };
}

export interface ShapePair {
  readonly asked: Readonly<Record<string, string>>;
  readonly without: AnswerShape;
  readonly with: AnswerShape;
}

/**
 * Run `processId` twice, synchronously, with the same inputs: once as the form
 * did before #F3, once with a format asked for each output that offers
 * several. `only` restricts the request to those outputs, as a person might.
 */
export async function shapesWithAndWithoutFormats(options: {
  readonly baseUrl: string;
  readonly processId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly only?: readonly string[];
  /** The user's choices, as the form's select makes them; the page's own when absent. */
  readonly choices?: FormatChoices;
  readonly fetch?: FetchLike;
}): Promise<ShapePair> {
  const client = createClient({
    baseUrl: options.baseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const full: ProcessDescription = await client.getProcess(options.processId);
  const description: ProcessDescription =
    options.only === undefined
      ? full
      : { ...full, outputs: full.outputs.filter((output) => options.only?.includes(output.id)) };
  const outputIds = description.outputs.map((output) => output.id);
  const asked = formatsToAsk(description.outputs, options.choices);
  const run = async (formats: Readonly<Record<string, string>>): Promise<AnswerShape> => {
    try {
      return await shapeOf(
        await client.execute(options.processId, {
          inputs: options.inputs,
          outputs: outputSelection(description, [], formats),
          description: full,
        }),
        outputIds,
      );
    } catch (error) {
      if (!(error instanceof ProcessesError)) throw error;
      return { kind: "refused", status: error.status, form: "raw", outputs: [] };
    }
  };
  return { asked, without: await run({}), with: await run(asked) };
}

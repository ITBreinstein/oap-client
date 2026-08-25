/**
 * The parts of an OGC API - Processes process description the form generator
 * reads. Declared for consumers; nothing here is trusted at runtime, because
 * the document is whatever the server chose to send.
 */

export interface InputDescription {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  /** Defaults to 1. Anything below 1 makes the input optional. */
  readonly minOccurs?: number | undefined;
  /** Defaults to 1. Above 1 — or `"unbounded"` — makes the input repeatable. */
  readonly maxOccurs?: number | "unbounded" | undefined;
  /** A JSON Schema fragment. */
  readonly schema?: unknown;
}

export interface ProcessDescription {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly version?: string | undefined;
  readonly inputs?: Readonly<Record<string, InputDescription>> | undefined;
}

/**
 * The form plan: a description of the controls an input form needs, as plain
 * data.
 *
 * It exists because of two boundary rules that pull in opposite directions.
 * `packages/core` may not render, so it cannot own the controls; and
 * `apps/web/src/map` may not import the core, so it can never be handed a JSON
 * Schema. A geometry input therefore reaches the map binding as
 * `{ kind: "bbox" }` — schema knowledge stops here, at the plan.
 *
 * The plan is also the reusable half of form generation: another nLDT party can
 * consume it without our viewer.
 */

export interface Option {
  readonly value: unknown;
  readonly label: string;
}

export interface TextControl {
  readonly kind: "text";
  readonly default?: string | undefined;
  /** JSON Schema `format` (`date-time`, `uri`, …), passed through as a hint. */
  readonly format?: string | undefined;
  readonly pattern?: string | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
}

export interface SelectControl {
  readonly kind: "select";
  readonly options: readonly Option[];
  readonly default?: unknown;
}

export interface NumberControl {
  readonly kind: "number";
  readonly integer: boolean;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly default?: number | undefined;
}

export interface CheckboxControl {
  readonly kind: "checkbox";
  readonly default?: boolean | undefined;
}

export type GeometryType =
  | "Point"
  | "MultiPoint"
  | "LineString"
  | "MultiLineString"
  | "Polygon"
  | "MultiPolygon"
  | "GeometryCollection";

/** What the server expects around the geometry, which the encoder needs later. */
export type GeometryWrapper = "geometry" | "feature" | "feature-collection";

export interface GeometryControl {
  readonly kind: "geometry";
  readonly wrapper: GeometryWrapper;
  /** Which geometries the drawing tool should offer. */
  readonly geometryTypes: readonly GeometryType[];
}

export interface BboxControl {
  readonly kind: "bbox";
  /** CRS URIs the server accepts; CRS84 when it does not say. */
  readonly crs: readonly string[];
}

/**
 * One control repeated. Both `type: "array"` and `maxOccurs > 1` normalise to
 * this, so the renderer needs one repeated-input component rather than two.
 */
export interface ListControl {
  readonly kind: "list";
  readonly item: Control;
  readonly minItems?: number | undefined;
  readonly maxItems?: number | undefined;
}

/**
 * The fallback: a raw JSON editor. `reason` says what defeated the resolver,
 * and is the same text carried on the matching {@link Diagnostic}.
 */
export interface JsonControl {
  readonly kind: "json";
  readonly reason: string;
  /** The schema fragment, so an editor can still show or validate against it. */
  readonly schema?: unknown;
}

export type Control =
  | TextControl
  | SelectControl
  | NumberControl
  | CheckboxControl
  | GeometryControl
  | BboxControl
  | ListControl
  | JsonControl;

export type DiagnosticCode =
  /** The input description carried no usable `schema`. */
  | "missing-schema"
  /** A JSON Schema keyword outside the supported subset. */
  | "unsupported-keyword"
  /** A type we deliberately do not generate a control for. */
  | "unsupported-type"
  /** The process description itself was not the shape the spec describes. */
  | "malformed-description";

/**
 * A recorded degradation. Every fall back to the JSON editor produces one:
 * these are the observations the interoperability matrix is built from, so
 * they are output, not logging.
 */
export interface Diagnostic {
  /** Absent when the diagnostic is about the description as a whole. */
  readonly inputId?: string | undefined;
  readonly code: DiagnosticCode;
  readonly message: string;
}

export interface FieldPlan {
  /** The key this value takes in the execute request's `inputs` object. */
  readonly id: string;
  /** The input's `title`, falling back to its id. */
  readonly title: string;
  readonly description?: string | undefined;
  /** From `minOccurs`, which defaults to 1. */
  readonly required: boolean;
  readonly control: Control;
  /** `contentMediaType`, kept for the encoder that qualifies the value. */
  readonly mediaType?: string | undefined;
}

export interface FormPlan {
  readonly processId?: string | undefined;
  /** In the order the server listed them. */
  readonly fields: readonly FieldPlan[];
  readonly diagnostics: readonly Diagnostic[];
}

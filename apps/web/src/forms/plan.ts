/**
 * The form plan: a description of the controls an input form needs, as plain
 * data.
 *
 * It exists because of two boundary rules that pull in opposite directions.
 * The core may not render, so it cannot own the controls; and
 * `apps/web/src/map` may not import the core, so it can never be handed a JSON
 * Schema. A geometry input therefore reaches the map binding as
 * `{ kind: "bbox" }` — schema knowledge stops here, at the plan.
 *
 * The plan is also the reusable half of form generation: another nLDT party can
 * consume it without our viewer. That is why this directory imports nothing
 * from React, the DOM, the map or the relay (T1, enforced by the
 * `form-plan-is-framework-free` dependency-cruiser rule): promoting it to the
 * core, or to a `forms` subpath export, is then a move rather than a rewrite.
 *
 * Ported from Sam's prototype on `feat/T3-prototype-interface`, with the fixes
 * in docs/reviews/forms-prototype-review.md. The review ids (R1…, N1…) are
 * cited where a fix landed.
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
  /**
   * The string is a document rather than a scalar: the schema gave it a
   * `contentMediaType`. JSON Schema has no "multi-line" keyword, and this is
   * the nearest thing the standard vocabulary has.
   */
  readonly multiline?: true | undefined;
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
  /** `min` itself is not allowed (R2). Either spelling of `exclusiveMinimum`. */
  readonly minExclusive?: true | undefined;
  readonly maxExclusive?: true | undefined;
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

/**
 * A GeoJSON input: drawn on the map, loaded from a file, or typed as GeoJSON.
 * The field holds the GeoJSON itself; the encoder wraps it (Requirement 20).
 */
export interface GeometryControl {
  readonly kind: "geometry";
  readonly wrapper: GeometryWrapper;
  /** Which geometries the drawing tool should offer. */
  readonly geometryTypes: readonly GeometryType[];
}

/** How many numbers a bounding box has: 2D is four, 3D is six (`bbox.yaml`). */
export type BboxDimension = 4 | 6;

export interface BboxControl {
  readonly kind: "bbox";
  /** CRS URIs the server accepts, in its order; CRS84 when it does not say. */
  readonly crs: readonly string[];
  /** The server's declared default, or the first of {@link crs} (R5). */
  readonly defaultCrs: string;
  /** Which coordinate counts the schema allows. A map-drawn box has four (R4). */
  readonly dimensions: readonly BboxDimension[];
}

/**
 * One way of supplying a complex input's value: one branch of its `oneOf`.
 *
 * A text branch carries the media type and encoding the encoder has to send
 * back in a qualified value (R7). A bare `type: "object"` branch is a JSON
 * object, sent as `{ "value": … }`.
 */
export interface ComplexFormat {
  readonly label: string;
  /** The branch's `contentMediaType`. Absent for a bare `type: "object"` branch. */
  readonly mediaType?: string | undefined;
  /** The branch's `contentEncoding`, e.g. `base64` or `UTF-8`. */
  readonly encoding?: string | undefined;
  /** The branch's `contentSchema`, when it is a URL. Shown, never fetched. */
  readonly contentSchema?: string | undefined;
  /** A bare `type: "object"` branch: the value is a JSON object, not text. */
  readonly object: boolean;
}

/**
 * A complex input offered in alternative encodings (T3). The one `oneOf`
 * pattern the resolver understands, because it is 99.9% of the `oneOf`s the
 * census found; every other composition stays a raw JSON editor.
 */
export interface ComplexControl {
  readonly kind: "complex";
  readonly formats: readonly ComplexFormat[];
  /**
   * Offer a URL for the server to fetch instead of an inline value.
   * `inlineOrRefData` admits a link for every input, and ZOO fetches one (Z7).
   */
  readonly byReference: boolean;
}

/**
 * One control repeated. `type: "array"` and `maxOccurs > 1` both produce one,
 * and an input that is both produces a list of lists (R10).
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
  | ComplexControl
  | ListControl
  | JsonControl;

export type DiagnosticCode =
  /** The input description carried no usable `schema`. */
  | "missing-schema"
  /** A JSON Schema keyword outside the supported subset. */
  | "unsupported-keyword"
  /** A type we deliberately do not generate a control for. */
  | "unsupported-type"
  // The prototype's `malformed-description` is gone: a description that is not
  // the shape the spec describes is the core's to report, in `ParseReport`, and
  // the detail screen shows those warnings (T2).
  /**
   * The schema contradicts itself, so no value can satisfy it: ZOO's SAGA
   * booleans carry `enum: ["true", "false"]` (N2). The control follows `type`.
   */
  | "contradictory-schema";

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
  /**
   * The schema keyword that caused it (`oneOf`, `type`, `enum`, …). Safe to
   * record: a keyword, never a value or a schema body (T4).
   */
  readonly keyword?: string | undefined;
}

export interface FieldPlan {
  /** The key this value takes in the execute request's `inputs` object. */
  readonly id: string;
  /** The input's `title`, falling back to its id. */
  readonly title: string;
  readonly description?: string | undefined;
  /** The core's `required` flag, never re-derived here (T2). */
  readonly required: boolean;
  readonly control: Control;
  /**
   * A top-level `contentMediaType`, for display. No longer used to qualify
   * the value: a single-format input's format is already known (N3).
   */
  readonly mediaType?: string | undefined;
}

export interface FormPlan {
  readonly processId?: string | undefined;
  /** In the order the server listed them. */
  readonly fields: readonly FieldPlan[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Errors raised *above* the transport, by the layers that understand OGC API -
 * Processes documents.
 *
 * They are deliberately not in `src/http/`. That directory is protocol-agnostic
 * — it knows about responses, not about landing pages — and "this document was
 * HTML when it should have been JSON" is a judgement only a layer that knows
 * what document it asked for can make.
 *
 * Same convention as the transport's errors: a distinct class per failure mode
 * so callers can narrow with `instanceof`, `{ cause }` where an underlying
 * error exists, and a message that names the URL. Every one of these will be
 * read by someone debugging a testbed service they do not control.
 */

/**
 * A document arrived with a non-JSON media type, and the `?f=json` fallback did
 * not help either.
 *
 * This is the HTML trap. `classify()` calls a `200 text/html` landing page `ok`
 * and is right to — nothing went wrong at the HTTP level. It is the document
 * layer that knows it asked for JSON.
 */
export class NotJsonError extends Error {
  override readonly name = "NotJsonError";
  /** Final URL after redirects. */
  readonly url: string;
  /** The media type actually received, or undefined if none was declared. */
  readonly mediaType: string | undefined;
  /** Whether `?f=json` was tried before giving up. */
  readonly triedFormatFallback: boolean;

  constructor(
    url: string,
    mediaType: string | undefined,
    triedFormatFallback: boolean,
    options?: { cause?: unknown },
  ) {
    const received = mediaType ?? "no declared media type";
    const tried = triedFormatFallback ? " even with ?f=json" : "";
    super(
      `Expected JSON from ${url} but received ${received}${tried}. ` +
        `The server may be content-negotiating to HTML.`,
      options,
    );
    this.url = url;
    this.mediaType = mediaType;
    this.triedFormatFallback = triedFormatFallback;
  }
}

/**
 * A link relation the operation needed was not advertised, and no path fallback
 * applied to it.
 *
 * Not every missing relation is fatal — a missing `conformance` link degrades to
 * a `./conformance` guess rather than raising this — so reaching this error
 * means the operation genuinely had nowhere to go.
 */
export class MissingLinkError extends Error {
  override readonly name = "MissingLinkError";
  /** The relation that was looked for, e.g. `processes`. */
  readonly relation: string;
  /** The document that should have advertised it. */
  readonly url: string;

  constructor(relation: string, url: string, options?: { cause?: unknown }) {
    super(
      `No "${relation}" link in the document at ${url}. ` +
        `Both the short relation name and the OGC URI form were checked.`,
      options,
    );
    this.relation = relation;
    this.url = url;
  }
}

/**
 * The response parsed as JSON, but its structure was not the document we asked
 * for: a landing page that is not an object, a conformance document whose
 * `conformsTo` is missing or not an array.
 *
 * Distinct from {@link NotJsonError} on purpose. "The server sent HTML" and
 * "the server sent JSON of the wrong shape" call for completely different
 * next steps, and collapsing them costs whoever is debugging an hour.
 */
export class MalformedDocumentError extends Error {
  override readonly name = "MalformedDocumentError";
  readonly url: string;
  /** Short, human-readable: what was expected and what was there instead. */
  readonly reason: string;

  constructor(url: string, reason: string, options?: { cause?: unknown }) {
    super(`Malformed document at ${url}: ${reason}`, options);
    this.url = url;
    this.reason = reason;
  }
}

/**
 * A process list or process description was JSON of the wrong shape, in one of
 * the few ways this layer treats as fatal.
 *
 * Strictness here has an asymmetric cost. A thrown error is a blank screen; a
 * degraded field is a form with one imperfect widget. So the fatal set is
 * deliberately tiny — the document is not an object, `processes` is not an
 * array, an entry has no string `id` — and everything else degrades and is
 * recorded as a warning on the observation.
 *
 * Distinct from {@link MalformedDocumentError} rather than reusing it, because
 * `where` is the part that matters: whoever reads this is staring at an
 * unfamiliar server's output and needs the offending index or id, not just the
 * URL of a document with 703 entries in it.
 */
export class MalformedProcessDocumentError extends Error {
  override readonly name = "MalformedProcessDocumentError";
  readonly url: string;
  /** What was expected and what was there instead. */
  readonly reason: string;
  /** The offending location, e.g. `entry at index 3`. Undefined for the whole document. */
  readonly where: string | undefined;

  constructor(url: string, reason: string, where?: string, options?: { cause?: unknown }) {
    const at = where === undefined ? "" : ` (${where})`;
    super(`Malformed process document at ${url}${at}: ${reason}`, options);
    this.url = url;
    this.reason = reason;
    this.where = where;
  }
}

/**
 * The service answered 404 for a process description.
 *
 * Worth its own type despite `classify()` already reporting an HTTP error: a
 * mistyped or withdrawn process id is a normal user-facing situation, and the
 * UI should say "no such process on this service" rather than "HTTP 404".
 *
 * Both reference servers make this reachable — pygeoapi 0.21.0 answers 404 with
 * a `NoSuchProcess` exception, and ZOO answers 404 with the OGC
 * `no-such-process` exception URI. Finding 0014's 400-for-an-unknown-*path*
 * does not apply: ZOO routes `/processes/{id}` and gets the status right there.
 */
export class ProcessNotFoundError extends Error {
  override readonly name = "ProcessNotFoundError";
  readonly processId: string;
  readonly url: string;

  constructor(processId: string, url: string, options?: { cause?: unknown }) {
    super(`No process "${processId}" on this service (404 from ${url})`, options);
    this.processId = processId;
    this.url = url;
  }
}

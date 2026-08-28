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

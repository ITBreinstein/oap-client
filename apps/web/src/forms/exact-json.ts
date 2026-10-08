/**
 * JSON text read so that its numbers are sent as written (W28).
 *
 * `JSON.parse` reads every number as a JavaScript double, and the core's
 * `JSON.stringify` writes the double back: a 19-digit identifier loses its
 * last digits, and `1e400` becomes `null`. Where the browser can hand over a
 * number's source text (`JSON.rawJSON`, with the reviver's `context.source`),
 * a number the double would change is kept as that text, and serialises as
 * written. A number the double holds exactly stays a plain number, so
 * everything else sees what it always saw.
 *
 * Where the browser cannot, {@link inexactNumbers} names the numbers that would
 * change, for the validator to refuse rather than send something else.
 */

interface SourceText {
  readonly source?: string;
}

interface WithSourceText {
  readonly rawJSON?: (text: string) => unknown;
}

/** Read on each call, not at load, so a test can take it away. */
function rawJson(): ((text: string) => unknown) | undefined {
  return (JSON as unknown as WithSourceText).rawJSON;
}

const NUMBER = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A JSON number's value, written one way: `1.50e1` and `15` are both `15e0`. */
function decimal(text: string): string {
  const match = NUMBER.exec(text);
  if (match === null) return text;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  if (digits === "") return "0";
  const significant = digits.replace(/0+$/, "");
  const scale =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - significant.length);
  return `${sign}${significant}e${String(scale)}`;
}

/** What `JSON.stringify` writes for the double this text reads as. */
function sentAs(text: string): string {
  return JSON.stringify(Number(text));
}

function isExact(text: string): boolean {
  return decimal(text) === decimal(sentAs(text));
}

/**
 * `JSON.parse`, keeping each number the double would change as written.
 * Throws what `JSON.parse` throws.
 */
export function parseExact(text: string): unknown {
  const raw = rawJson();
  if (raw === undefined) return JSON.parse(text);
  return JSON.parse(text, (_key: string, value: unknown, context?: SourceText) =>
    typeof value === "number" && context?.source !== undefined && !isExact(context.source)
      ? raw(context.source)
      : value,
  );
}

/** JSON's own number grammar: no leading zeros, `+`, bare point or hex. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * True when `text` is a JSON number, so {@link parseExact} reads it, and
 * {@link inexactNumbers} can say whether a double would change it. A number
 * field's text goes that way too: typed as `1234567890123456789`, it is sent
 * as typed.
 */
export function isJsonNumber(text: string): boolean {
  return JSON_NUMBER.test(text);
}

/** A number this browser would send as something else. */
export interface InexactNumber {
  readonly written: string;
  readonly sent: string;
}

/**
 * The numbers in valid JSON text that would not be sent as written: none where
 * the browser keeps them ({@link parseExact}), and none for text that does not
 * parse, which the validator reports on its own.
 */
export function inexactNumbers(text: string): readonly InexactNumber[] {
  if (rawJson() !== undefined) return [];
  try {
    JSON.parse(text);
  } catch {
    return [];
  }
  // Strings out first: what is left of valid JSON that looks like a number is one.
  const tokens =
    text.replace(/"(?:[^"\\]|\\.)*"/g, '""').match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  return tokens
    .filter((token) => !isExact(token))
    .map((token) => ({ written: token, sent: sentAs(token) }));
}

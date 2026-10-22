/**
 * What is wrong with JSON typed in a box, in a visitor's words (#13): where
 * to look, from the parser's own message, which is kept for developers. The
 * parsers say it differently: V8 "… at position 12 (line 1 column 13)",
 * an older V8 only "at position 12", Firefox "… at line 1 column 13 of the
 * JSON data"; V8's "Unexpected token" and WebKit say nothing of where.
 */

export interface JsonTrouble {
  /** The line to look at, from 1; unknown when the parser does not say. */
  readonly line: number | undefined;
  /** Whether the text stops before the JSON is complete. */
  readonly atEnd: boolean;
  /** The parser's own message. */
  readonly detail: string;
}

/** The line of `text` a parser's message points at, if it says. */
export function lineOfMessage(text: string, message: string): number | undefined {
  const line = /\bline (\d+)/i.exec(message);
  if (line !== null) return Number(line[1]);
  const position = /\bposition (\d+)/i.exec(message);
  if (position === null) return undefined;
  const before = text.slice(0, Number(position[1]));
  return before.split("\n").length;
}

/** What is wrong with `text` as JSON; nothing when it parses. */
export function jsonTrouble(text: string): JsonTrouble | undefined {
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const position = /\bposition (\d+)/i.exec(detail);
    return {
      line: lineOfMessage(text, detail),
      atEnd:
        /\bend of (JSON )?(input|data)\b|unexpected EOF/i.test(detail) ||
        (position !== null && Number(position[1]) >= text.trimEnd().length),
      detail,
    };
  }
}

/** The plain message for a box that holds no valid JSON. */
export function plainJsonMessage(trouble: JsonTrouble): string {
  const where = trouble.atEnd
    ? " near the end"
    : trouble.line === undefined
      ? ""
      : ` near line ${String(trouble.line)}`;
  return `This isn’t valid JSON: check the quotes and brackets${where}.`;
}

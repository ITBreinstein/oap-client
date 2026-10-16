/**
 * JSON text laid out again: one member or item per line, indented with
 * tabs. Only the whitespace between tokens changes; every string and number
 * is kept exactly as typed, so a value sent as typed (W28) is still the same
 * value: `1.0` stays `1.0`, a 20-digit identifier keeps every digit.
 *
 * Text that isn't JSON comes back as `undefined`, and is left as it is.
 */
export function formatJsonText(text: string): string | undefined {
  if (text.trim() === "") return undefined;
  try {
    JSON.parse(text);
  } catch {
    return undefined;
  }
  let out = "";
  let depth = 0;
  let at = 0;
  const newline = () => `\n${"\t".repeat(depth)}`;
  // Only these four are whitespace in JSON; parsing above refused any other.
  const space = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  while (at < text.length) {
    const ch = text[at];
    if (ch === '"') {
      let end = at + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(at, end + 1);
      at = end + 1;
    } else if (space(ch)) {
      at += 1;
    } else if (ch === "{" || ch === "[") {
      const close = ch === "{" ? "}" : "]";
      let next = at + 1;
      while (space(text[next])) next += 1;
      if (text[next] === close) {
        out += `${ch}${close}`;
        at = next + 1;
      } else {
        depth += 1;
        out += `${ch}${newline()}`;
        at += 1;
      }
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      out += `${newline()}${ch}`;
      at += 1;
    } else if (ch === ",") {
      out += `,${newline()}`;
      at += 1;
    } else if (ch === ":") {
      out += ": ";
      at += 1;
    } else {
      // A number, true, false or null: kept as typed, up to the next token.
      let end = at;
      while (end < text.length && !space(text[end]) && !',:{}[]"'.includes(text[end] ?? "")) {
        end += 1;
      }
      out += text.slice(at, end);
      at = end;
    }
  }
  return out;
}

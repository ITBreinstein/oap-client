/**
 * A CSV result read into rows, to show as a table (#26). RFC 4180: fields
 * separated by commas, records by CRLF or LF; a field in double quotes may
 * hold commas, line breaks and doubled quotes (`""` for one `"`). One
 * trailing line break ends the last record, not a new empty one.
 *
 * Only for showing. The download is the server's bytes, untouched. Text that
 * is not CSV as RFC 4180 has it, a quote left open, say, is not a table:
 * `undefined`, and the page shows it as text.
 */
export function parseCsv(text: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Whether the field under way began with a quote, and that quote has closed.
  let closed = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text.charAt(i);
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        closed = true;
      } else {
        field += char;
      }
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
    } else if (char === "\n" || char === "\r") {
      endRow();
      if (char === "\r" && text[i + 1] === "\n") i += 1;
    } else if (char === '"' && field === "" && !closed) {
      quoted = true;
    } else if (closed) {
      // Text after a field's closing quote: not RFC 4180.
      return undefined;
    } else {
      field += char;
    }
    i += 1;
  }
  if (quoted) return undefined;
  // The last record, unless the text ended with its line break.
  if (field !== "" || closed || row.length > 0) endRow();
  return rows;
}

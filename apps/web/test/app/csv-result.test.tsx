/**
 * #26 on screen: a CSV result is a table of its first rows, says how many
 * more the download holds, and downloads as .csv. Text that is no CSV the
 * page can read stays text.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CSV_ROWS_SHOWN, ResultsView } from "../../src/app/ResultsView.js";
import { UpdatedContext } from "../../src/app/variant.js";

let root: Root | undefined;
let host: HTMLElement | undefined;

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(node);
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

function csv(rows: number): string {
  const lines = ["number,name"];
  for (let i = 1; i <= rows; i += 1) lines.push(`${String(i)},"Plot ${String(i)}, north"`);
  return `${lines.join("\n")}\n`;
}

function view(text: string, mediaType = "text/csv", updated = false): HTMLElement {
  return render(
    <UpdatedContext value={updated}>
      <ResultsView
        results={[{ kind: "text", outputId: "table", value: text, mediaType }]}
        processId="breinstein-feature-area"
        onLoad={() => Promise.resolve()}
      />
    </UpdatedContext>,
  );
}

describe("a CSV result", () => {
  for (const updated of [false, true]) {
    it(`is a table with its first row as the heading (${updated ? "updated" : "Instrument"})`, () => {
      const page = view(csv(2), "text/csv", updated);
      const table = page.querySelector(".csv-table table");
      expect(table).not.toBeNull();
      expect([...(table?.querySelectorAll("th") ?? [])].map((th) => th.textContent)).toEqual([
        "number",
        "name",
      ]);
      expect([...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => tr.textContent)).toEqual([
        "1Plot 1, north",
        "2Plot 2, north",
      ]);
      expect(page.querySelector('[data-testid="csv-more"]')).toBeNull();
      expect(page.querySelector(".csv-table")?.getAttribute("aria-label")).toBe("Table “table”");
    });
  }

  it("shows the first 50 rows, and says how many more the download has", () => {
    const page = view(csv(CSV_ROWS_SHOWN + 7));
    expect(page.querySelectorAll(".csv-table tbody tr")).toHaveLength(CSV_ROWS_SHOWN);
    expect(page.querySelector('[data-testid="csv-more"]')?.textContent).toBe(
      "and 7 more rows; download for all.",
    );
  });

  it("says one more row, not one more rows", () => {
    const page = view(csv(CSV_ROWS_SHOWN + 1));
    expect(page.querySelector('[data-testid="csv-more"]')?.textContent).toBe(
      "and 1 more row; download for all.",
    );
  });

  it("downloads as .csv", () => {
    const page = view(csv(1));
    expect(page.querySelector(".actions button")?.textContent).toBe(
      "Download breinstein-feature-area-table.csv",
    );
  });

  it("stays text when it is no CSV the page can read", () => {
    const page = view('a,"b\n1,2');
    expect(page.querySelector(".csv-table")).toBeNull();
    expect(page.querySelector("pre.code")?.textContent).toBe('a,"b\n1,2');
  });

  it("is not a table when the text is plain text that happens to have commas", () => {
    const page = view("a,b\n1,2\n", "text/plain");
    expect(page.querySelector(".csv-table")).toBeNull();
    expect(page.querySelector(".actions button")?.textContent).toBe(
      "Download breinstein-feature-area-table.txt",
    );
  });
});

describe("a CSV result's Copy", () => {
  it("copies the CSV as the service sent it, in the updated Instrument", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
    const text = csv(2);
    const page = view(text, "text/csv", true);
    const button = page.querySelector<HTMLButtonElement>(".code-box .copy-button");
    expect(button?.getAttribute("aria-label")).toBe("Copy result");
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(copied).toEqual([text]);
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("is not there in Instrument as it is", () => {
    expect(view(csv(2)).querySelector(".copy-button")).toBeNull();
  });
});

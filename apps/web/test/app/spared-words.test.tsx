/**
 * #43: what a visitor is spared in the updated Instrument, and the names My
 * jobs uses. With `?developer`, and in Instrument as it is, nothing changes.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DeveloperContext, withoutRecordNote } from "../../src/app/developer.js";
import { ErrorMessage } from "../../src/app/ErrorMessage.js";
import {
  learnTitles,
  NO_TITLES,
  processTitle,
  serviceTitle,
  titleKey,
} from "../../src/app/titles.js";
import { UpdatedContext } from "../../src/app/variant.js";

const CORS = {
  title:
    "This page could not read this server: it sends no CORS headers, or it could not be reached. The attempt has been recorded.",
  detail: "A browser gives a web page the same error for both.",
};

describe("withoutRecordNote", () => {
  it("drops the sentence, and only it", () => {
    expect(withoutRecordNote(CORS.title)).toBe(
      "This page could not read this server: it sends no CORS headers, or it could not be reached.",
    );
  });

  it("drops its longer form too", () => {
    expect(
      withoutRecordNote(
        "Use the service's https:// address if it has one. The attempt has been recorded as mixed content, not as a server failure.",
      ),
    ).toBe("Use the service's https:// address if it has one.");
  });

  it("leaves text without it as it is", () => {
    expect(withoutRecordNote("The service reported an error.")).toBe(
      "The service reported an error.",
    );
  });
});

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(updated: boolean, developer: boolean): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      <UpdatedContext value={updated}>
        <DeveloperContext value={developer}>
          <ErrorMessage error={CORS} />
        </DeveloperContext>
      </UpdatedContext>,
    );
  });
  return host;
}

describe("an error's words", () => {
  it("spare a visitor the recorded sentence in the updated Instrument", () => {
    expect(render(true, false).textContent).not.toContain("recorded");
  });

  it("keep it with ?developer", () => {
    expect(render(true, true).textContent).toContain("The attempt has been recorded.");
  });

  it("keep it in Instrument as it is", () => {
    expect(render(false, false).textContent).toContain("The attempt has been recorded.");
  });
});

describe("titles", () => {
  const BASE = "http://localhost:5080";
  const processes = [{ id: "slow", title: "Slow process" }, { id: "untitled" }];

  it("learns a service's title and its processes' titles", () => {
    const titles = learnTitles(NO_TITLES, `${BASE}/`, "pygeoapi (CORS enabled)", processes);
    expect(serviceTitle(titles, [], BASE)).toBe("pygeoapi (CORS enabled)");
    expect(processTitle(titles, [], BASE, "slow")).toBe("Slow process");
    expect(titles.processes.has(titleKey(BASE, "untitled"))).toBe(false);
  });

  it("is the same object when there is nothing new, so it can be learned while rendering", () => {
    const titles = learnTitles(NO_TITLES, BASE, "pygeoapi", processes);
    expect(learnTitles(titles, BASE, "pygeoapi", processes)).toBe(titles);
    expect(learnTitles(titles, BASE, undefined, [])).toBe(titles);
  });

  it("falls back to an example's title, then the id", () => {
    const examples = [{ service: BASE, process: "hello-world", title: "Hello World" }];
    expect(processTitle(NO_TITLES, examples, BASE, "hello-world")).toBe("Hello World");
    expect(processTitle(NO_TITLES, examples, BASE, "slow")).toBe("slow");
  });

  it("falls back to a preset's title, then the host", () => {
    const presets = [{ title: "Reference pygeoapi", url: "https://ogc.example.org/" }];
    expect(serviceTitle(NO_TITLES, presets, "https://ogc.example.org")).toBe("Reference pygeoapi");
    expect(serviceTitle(NO_TITLES, presets, BASE)).toBe("localhost:5080");
  });
});

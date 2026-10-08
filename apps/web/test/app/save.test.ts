/**
 * The object URL behind a download outlives the click (review W26): revoked
 * on the next turn, WebKit can lose the download it had just started.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { REVOKE_AFTER_MS, saveBlob } from "../../src/app/save.js";

const revoked: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  revoked.length = 0;
  // jsdom has no object URLs.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:http://page.test/1",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

it("keeps the URL for the download, then revokes it", () => {
  const clicked: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(`${this.download} ${this.href}`);
  });

  saveBlob(new Blob(["{}"], { type: "application/json" }), "result.json");
  expect(clicked).toEqual(["result.json blob:http://page.test/1"]);
  expect(document.querySelector("a[download]")).toBeNull();

  vi.advanceTimersByTime(1_000);
  expect(revoked).toEqual([]);
  vi.advanceTimersByTime(REVOKE_AFTER_MS);
  expect(revoked).toEqual(["blob:http://page.test/1"]);
  click.mockRestore();
});

/**
 * Europe behind Instrument's start screen, and the switch between light and
 * dark in every style.
 *
 * - The theme picks the picture. On load the page asks for the one it shows;
 *   once the page is idle, the other one, once, so a switch has it at hand.
 *   Not when the connection asks to save data.
 * - The other styles never ask for either.
 * - A switch fades where the browser can, is instant where motion is
 *   reduced, and quick toggling ends on the last choice.
 * - Both pictures come from this site, never from NASA's or Wikimedia's
 *   servers: they are committed, and the page must not hand a visitor's
 *   address to anyone.
 */

import { expect, test, type Page } from "@playwright/test";

const DAY = /europe-day[^/]*\.webp$/;
const NIGHT = /europe-night[^/]*\.webp$/;
const PICTURE = { light: DAY, dark: NIGHT } as const;
const THIRD_PARTY = /(^|\.)(nasa\.gov|wikimedia\.org|wikipedia\.org)$/;

interface Seen {
  readonly url: string;
  /** Asked for after the page's `load` event. */
  readonly afterLoad: boolean;
}

/** Every address the page asks for, from before it loads, in order. */
function requests(page: Page): Seen[] {
  const seen: Seen[] = [];
  let loaded = false;
  page.on("load", () => {
    loaded = true;
  });
  page.on("request", (request) => {
    seen.push({ url: request.url(), afterLoad: loaded });
  });
  return seen;
}

const pictures = (seen: Seen[]) => seen.filter(({ url }) => DAY.test(url) || NIGHT.test(url));

async function open(page: Page, query: string) {
  // No services and no examples: the start screen alone.
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ relay: null, presets: [], examples: [] }),
    }),
  );
  await page.goto(`/?${query}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

/** Past two frames and the browser's next idle moment: the page's own idle work has run. */
async function idle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestIdleCallback(resolve, { timeout: 5000 })),
        );
      }),
  );
}

/**
 * Count the view transitions the page starts, and run `__onTransition`, when
 * a test sets one, just after a transition starts and before it changes the
 * page.
 */
async function countTransitions(page: Page) {
  await page.addInitScript(() => {
    const start = Document.prototype.startViewTransition;
    Reflect.set(globalThis, "__transitions", 0);
    Document.prototype.startViewTransition = function (this: Document, ...args) {
      Reflect.set(
        globalThis,
        "__transitions",
        Number(Reflect.get(globalThis, "__transitions")) + 1,
      );
      const transition = start.apply(this, args);
      const hook: unknown = Reflect.get(globalThis, "__onTransition");
      if (typeof hook === "function") hook();
      return transition;
    };
  });
}

const transitions = (page: Page) =>
  page.evaluate(() => Number(Reflect.get(globalThis, "__transitions")));

async function openAppearance(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Appearance" }).click();
  return page.getByRole("dialog", { name: "Appearance" });
}

/** The picture the start screen draws, by its address. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const layout = document.querySelector(".layout-single");
    return layout === null ? "" : getComputedStyle(layout).backgroundImage;
  });

/** Whether the page has the picture at `pattern`, fully downloaded. */
const downloaded = (page: Page, pattern: RegExp) =>
  page.evaluate(
    (source) =>
      performance
        .getEntriesByType("resource")
        .some(
          (entry) =>
            new RegExp(source).test(entry.name) &&
            entry instanceof PerformanceResourceTiming &&
            entry.responseEnd > 0,
        ),
    pattern.source,
  );

function expectNoThirdParty(seen: Seen[]) {
  const hosts = seen.map(({ url }) => new URL(url).hostname);
  expect(hosts.filter((host) => THIRD_PARTY.test(host))).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  const other = theme === "light" ? "dark" : "light";

  test(`instrument ${theme}: its own picture first, the other once the page is idle, once`, async ({
    page,
  }) => {
    const seen = requests(page);
    const later = page.waitForRequest(PICTURE[other]);
    await open(page, `style=instrument&theme=${theme}`);
    await later;
    await idle(page);

    const asked = pictures(seen);
    expect(asked[0]?.url).toMatch(PICTURE[theme]);
    const others = asked.filter(({ url }) => PICTURE[other].test(url));
    expect(others).toHaveLength(1);
    expect(others[0]?.afterLoad).toBe(true);
    expectNoThirdParty(seen);
  });
}

test("instrument on a connection that saves data: never the other picture", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "connection", {
      configurable: true,
      get: () => ({ saveData: true }),
    });
  });
  const seen = requests(page);
  await open(page, "style=instrument&theme=light");
  await idle(page);
  await page.waitForTimeout(500);

  expect(pictures(seen).map(({ url }) => DAY.test(url))).toEqual([true]);
  expectNoThirdParty(seen);
});

test("instrument: toggling quickly ends on the last choice, with its picture", async ({ page }) => {
  const seen = requests(page);
  await open(page, "style=instrument&theme=light");
  const dialog = await openAppearance(page);
  const off = dialog.getByRole("radio", { name: "Off" });
  await off.focus();

  // Keys, not clicks: a fade under way takes the pointer, never the keyboard.
  await page.keyboard.press("ArrowDown"); // On
  await page.keyboard.press("ArrowUp"); // Off
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => drawn(page)).toMatch(/europe-day/);

  await page.keyboard.press("ArrowDown"); // On
  await page.keyboard.press("ArrowUp"); // Off
  await page.keyboard.press("ArrowDown"); // On
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => drawn(page)).toMatch(/europe-night/);
  await expect.poll(() => downloaded(page, NIGHT)).toBe(true);
  // No fade left hanging.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);

  expectNoThirdParty(seen);
});

test("instrument: a switch back while a fade is starting ends on the newer choice", async ({
  page,
}) => {
  await countTransitions(page);
  await open(page, "style=instrument&theme=light");
  const dialog = await openAppearance(page);
  // The moment the fade to dark has started, before it has changed the page:
  // back to light, once.
  await page.evaluate(() => {
    Reflect.set(globalThis, "__onTransition", () => {
      Reflect.set(globalThis, "__onTransition", undefined);
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>('input[type="radio"][value="light"]')?.click();
      });
    });
  });
  await dialog.getByRole("radio", { name: "On" }).check({ force: true });

  await expect.poll(() => transitions(page)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => drawn(page)).toMatch(/europe-day/);
});

for (const style of ["hybrid", "precise", "instrument"]) {
  test(`${style}: a switch fades, and is instant where motion is reduced`, async ({ page }) => {
    await countTransitions(page);
    await open(page, `style=${style}&theme=light`);
    const dialog = await openAppearance(page);
    await dialog.getByRole("radio", { name: "On" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await transitions(page)).toBe(1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await dialog.getByRole("radio", { name: "Off" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await transitions(page)).toBe(1);
  });
}

test("instrument following the system: the system's switch fades too", async ({ page }) => {
  await countTransitions(page);
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "style=instrument&theme=system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => drawn(page)).toMatch(/europe-night/);
  expect(await transitions(page)).toBe(1);
});

for (const style of ["hybrid", "precise"]) {
  for (const theme of ["light", "dark"]) {
    test(`${style} ${theme} keeps its streets and never asks for a picture`, async ({ page }) => {
      const seen = requests(page);
      await open(page, `style=${style}&theme=${theme}`);
      await idle(page);
      await page.waitForTimeout(500);
      expect(pictures(seen)).toEqual([]);
      expectNoThirdParty(seen);
    });
  }
}

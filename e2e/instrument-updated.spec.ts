/**
 * Instrument and its update side by side (ADR 0002): each change the update
 * makes shows in it and not in Instrument as it is.
 *
 * `config.json` allows https: services only, so the preset names a test
 * address, which this spec answers from the local pygeoapi.
 */

import { expect, test, type Page } from "@playwright/test";
import { RELAY } from "./servers.js";
import { requireService } from "./services.js";

const PYGEOAPI = "http://localhost:5080";
const SERVICE = "https://pygeoapi.example.test";
const VERSIONS = [
  { style: "instrument", updated: false },
  { style: "instrument-updated", updated: true },
] as const;

/** A map style with nothing to fetch, standing in for OpenFreeMap's. */
const WORLD_STAND_IN = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#f8f4f0" } }],
};

async function open(page: Page, style: string) {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: null,
        presets: [{ title: "Reference pygeoapi", url: SERVICE }],
        examples: [
          {
            service: SERVICE,
            process: "hello-world",
            title: "Hello World",
            summary: "Type a name; the service greets it back.",
            needs: "values",
            featured: true,
          },
        ],
      }),
    }),
  );
  await page.route(`${SERVICE}/**`, async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(SERVICE, PYGEOAPI) });
    await route.fulfill({ response });
  });
  // The updated Instrument's world map is OpenFreeMap's: a plain stand-in
  // here, so this lane never waits on a third party.
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await page.goto(`/?style=${style}&theme=light`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

async function connect(page: Page) {
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
}

/** Copy is 44px high to press, and its tooltip says its name on hover and on focus; Escape hides it. */
async function tooltipSaysIts(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  // The tooltip says the name, on hover and on keyboard focus; Escape hides it.
  const tip = page.locator(".copy", { has: button }).locator(".copy-tip");
  await expect(tip).toBeHidden();
  await button.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(name);
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await page.mouse.move(0, 0);
  await button.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
}

const rail = (page: Page, name: string) =>
  page.getByRole("banner").getByRole("button", { name, exact: true });

test.beforeEach(async () => {
  await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
});

for (const { style, updated } of VERSIONS) {
  test.describe(style, () => {
    test(`on a phone, About is ${updated ? "in" : "not in"} the bar`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, style);
      const about = rail(page, "About");
      if (!updated) {
        await expect(about).toBeHidden();
        return;
      }
      await about.click();
      await expect(
        page.getByRole("dialog", { name: "About" }).getByText("Where your requests go"),
      ).toBeVisible();
    });

    test(`an open panel ${updated ? "dims" : "doesn't dim"} the page behind it`, async ({
      page,
    }) => {
      await open(page, style);
      await rail(page, "Examples").click();
      await expect(page.getByRole("dialog", { name: "Examples" })).toBeVisible();
      const wash = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".app-body") ?? document.body, "::after").content,
      );
      expect(wash !== "none" && wash !== "normal").toBe(updated);
    });

    test(`the list ${updated ? "leaves out" : "shows"} columns with nothing in them yet`, async ({
      page,
    }) => {
      await open(page, style);
      await connect(page);
      const heads = page.locator(".process-head .label");
      await expect(heads.filter({ hasText: "Needs" })).toBeVisible({ visible: !updated });
      await expect(heads.filter({ hasText: "This visit" })).toBeVisible({ visible: !updated });

      // Once a process has run, "This visit" has something to say in either.
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "All processes" }).click();
      await expect(heads.filter({ hasText: "This visit" })).toBeVisible();
      await expect(heads.filter({ hasText: "Needs" })).toBeVisible();
    });

    test(`the request log ${updated ? "stays in the column" : "lies over the map"}`, async ({
      page,
    }) => {
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
      await page.locator(".map-pane canvas").waitFor();
      const position = await page
        .locator(".request-log")
        .evaluate((log) => getComputedStyle(log).position);
      expect(position).toBe(updated ? "static" : "fixed");
    });

    test(`picking a listed service ${updated ? "fills in" : "leaves"} the address`, async ({
      page,
    }) => {
      await open(page, style);
      await expect(page.locator(".start-card .eyebrow")).toBeVisible({ visible: !updated });
      await page.getByRole("radio", { name: /Another service/ }).check();
      await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
      await expect(page.getByRole("textbox", { name: "Service address" })).toHaveValue(
        updated ? SERVICE : "",
      );
    });

    test(`a process without a map ${updated ? "is" : "isn't"} on the picture, credited`, async ({
      page,
    }) => {
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Hello World" })).toBeVisible();
      // In the update, the form docked at the left and the picture beside it (#36).
      const picture = await page
        .locator(updated ? ".backdrop-pane" : ".layout-single")
        .evaluate((layout) => getComputedStyle(layout).backgroundImage);
      expect(picture.includes("europe-")).toBe(updated);
      await expect(page.locator(".backdrop-credit")).toBeVisible({ visible: updated });
      // Instrument as it is keeps its card, and nothing to resize.
      await expect(page.locator(".layout-single")).toHaveCount(updated ? 0 : 1);
      await expect(page.getByRole("separator", { name: "Width of the form" })).toHaveCount(
        updated ? 1 : 0,
      );
    });

    test(`the requests are ${updated ? "in the developer section" : "under the form"}; inputs and outputs ${updated ? "copy" : "don't copy"}`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await open(page, style);
      await connect(page);
      await page.getByRole("button", { name: "Hello World", exact: true }).click();
      await expect(page.locator(".process-screen .request-log")).toHaveCount(updated ? 0 : 1);
      await expect(page.locator("details.developer .request-log")).toHaveCount(updated ? 1 : 0);

      const field = page.getByRole("textbox", { name: /Name/ });
      const copyName = page.getByRole("button", { name: "Copy Name", exact: true });
      const copyOutput = page.getByRole("button", { name: "Copy result", exact: true });
      const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
      // In the box: none while it is empty.
      await expect(copyName).toHaveCount(0);
      await field.fill("Geonovum");
      await expect(copyName).toHaveCount(updated ? 1 : 0);
      if (updated) {
        await expect(
          page.locator(".copy-field", { has: field }).locator(".copy-button"),
        ).toHaveCount(1);
        // Pasted back into the box, the same value.
        await copyName.click();
        await expect.poll(clipboard).toBe("Geonovum");
        await field.fill("");
        await field.focus();
        await page.keyboard.press("ControlOrMeta+V");
        await expect(field).toHaveValue("Geonovum");
      }

      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "Change the inputs" }).waitFor();
      // The record of what was sent has no Copy; the result has, in the update.
      await expect(page.getByTestId("sent-inputs").getByRole("button")).toHaveCount(0);
      if (!updated) {
        await expect(copyOutput).toHaveCount(0);
        return;
      }
      // A plain value's Copy copies the value (#27); its JSON, folded, has its own.
      await copyOutput.click();
      await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
      expect(await clipboard()).toBe("Hello Geonovum!");
      await page.locator('[data-output-id="echo"] summary').click();
      await page.getByRole("button", { name: "Copy result as JSON", exact: true }).click();
      await expect.poll(clipboard).toBe('{\n\t"id": "echo",\n\t"value": "Hello Geonovum!"\n}');
    });
  });
}

test("instrument-updated: the background box is centred on its words, beside the map too", async ({
  page,
}) => {
  await open(page, "instrument-updated");
  await connect(page);
  for (const name of ["Hello World", "Buildings in an area"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const offset = await page.locator(".run-bar label.choice").evaluate((label) => {
      const box = label.querySelector("input")?.getBoundingClientRect();
      const words = [...label.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
      );
      if (box === undefined || words === undefined) return Number.NaN;
      const range = document.createRange();
      range.selectNodeContents(words);
      const text = range.getBoundingClientRect();
      return (box.top + box.bottom - (text.top + text.bottom)) / 2;
    });
    expect(Math.abs(offset)).toBeLessThanOrEqual(1);
    await page.getByRole("banner").getByRole("button", { name: "Processes", exact: true }).click();
  }
});

for (const { style, updated } of VERSIONS) {
  test(`${style}: a job ${updated ? "can" : "can't"} be run again from My jobs, its inputs filled in`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await requireService(`${RELAY}/healthz`, "the relay");
    // Through the relay: it finds a background job where a page alone can't.
    await page.route("**/config.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ relay: { url: RELAY }, presets: [], examples: [] }),
      }),
    );
    await page.goto(`/?style=${style}&theme=light`);
    await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Slow process", exact: true }).click();
    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("1");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.locator('[data-output-id="slept"]').waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "All processes" }).click();

    await rail(page, "Jobs").click();
    const again = page.getByTestId("my-jobs").getByRole("button", { name: "Run again" });
    if (!updated) {
      await expect(again).toHaveCount(0);
      return;
    }
    await again.click();
    await expect(page.getByRole("heading", { level: 2, name: "Slow process" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Seconds (optional)" })).toHaveValue("1");
    await expect(page.getByRole("checkbox", { name: "Run in the background" })).toBeChecked();
  });
}

test("instrument-updated: About as beside a map, the way back a button, the credit in the corner, Copy an icon", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "instrument-updated");
  await connect(page);
  await page.getByRole("button", { name: "Hello World", exact: true }).click();

  const boxOf = (selector: string) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderTopStyle, style.borderTopWidth, style.paddingTop, style.borderRadius];
    });
  // Docked at the left, map or not (#36): About as it is beside a map.
  const withoutMap = await boxOf("details.about");
  await page.getByRole("button", { name: "All processes" }).click();
  await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
  await page.locator(".map-pane canvas").waitFor();
  expect(await boxOf("details.about")).toEqual(withoutMap);
  await page.getByRole("button", { name: "All processes" }).click();
  await page.getByRole("button", { name: "Hello World", exact: true }).click();

  const back = page.getByRole("button", { name: "All processes" });
  expect(await back.evaluate((button) => getComputedStyle(button).borderTopStyle)).toBe("solid");

  // A short page: the credit in the corner, 12px from the window's edges.
  const credit = await page.locator(".backdrop-credit").evaluate((chip) => {
    const box = chip.getBoundingClientRect();
    return { right: innerWidth - box.right, bottom: innerHeight - box.bottom };
  });
  expect(credit).toEqual({ right: 12, bottom: 12 });

  await page.getByRole("textbox", { name: /Name/ }).fill("hello");
  await tooltipSaysIts(page, "Copy Name");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const copy = page.locator(".code-box").getByRole("button", { name: "Copy result", exact: true });
  await expect(copy).toBeVisible();
  await expect(copy).toHaveText("");
  await expect(copy.locator("svg")).toHaveCount(1);
  // 44px square to press, with a smaller face.
  const sizes = await copy.evaluate((button) => {
    const outer = button.getBoundingClientRect();
    const face = button.querySelector(".copy-face")?.getBoundingClientRect();
    return [outer.width, outer.height, face?.width, face?.height];
  });
  expect(sizes).toEqual([44, 44, 32, 32]);
  await tooltipSaysIts(page, "Copy result");

  // Beside the map, the draw tools are filled, not the panel's own colour.
  await page.getByRole("banner").getByRole("button", { name: "Processes", exact: true }).click();
  await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
  await page.locator(".map-pane canvas").waitFor();
  for (const name of ["Draw on the map", "Clear"]) {
    const filled = await page
      .getByRole("button", { name, exact: true })
      .evaluate(
        (button) =>
          getComputedStyle(button).backgroundColor !==
          getComputedStyle(button.closest(".panel") ?? document.body).backgroundColor,
      );
    expect(filled).toBe(true);
  }
});

/** Where `chip` meets anything drawn over it, or an empty list (4px in, clear of its rounded corners). */
async function covering(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((chip) => {
    const box = chip.getBoundingClientRect();
    const over: string[] = [];
    for (const x of [box.left + 4, box.left + box.width / 2, box.right - 4]) {
      for (const y of [box.top + 4, box.top + box.height / 2, box.bottom - 4]) {
        const top = document.elementFromPoint(x, y);
        if (top !== null && !chip.contains(top)) over.push(top.outerHTML.slice(0, 80));
      }
    }
    return over;
  });
}

/** Contrast of the credit's words on its wash, over pure white and over pure black. */
async function creditContrast(page: Page): Promise<number[]> {
  return page.locator(".backdrop-credit").evaluate((chip) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no canvas");
    const paint = (...layers: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const fill of layers) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (rgb: number[]) => {
      const [r = 0, g = 0, b = 0] = rgb.map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: number[], b: number[]) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    };
    const style = getComputedStyle(chip);
    const words = paint("#000", style.color);
    return ["#fff", "#000"].map((picture) => ratio(words, paint(picture, style.backgroundColor)));
  });
}

for (const size of [
  { width: 1440, height: 960 },
  { width: 1280, height: 720 },
  // Narrow beside the rail: the column reaches the corner.
  { width: 960, height: 640 },
  // A phone: the rail a bar at the foot, the credit ending the page.
  { width: 390, height: 844 },
]) {
  test(`instrument-updated at ${String(size.width)}×${String(size.height)}: the credit is never under anything`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await open(page, "instrument-updated");
    const pages = [
      { name: "the start screen", go: () => Promise.resolve() },
      { name: "the process list", go: () => connect(page) },
      {
        name: "a process",
        go: () => page.getByRole("button", { name: "Hello World", exact: true }).click(),
      },
      {
        name: "a result",
        go: async () => {
          await page.getByRole("textbox", { name: /Name/ }).fill("hello");
          await page.getByRole("button", { name: "Run", exact: true }).click();
          await page.getByRole("button", { name: "Change the inputs" }).waitFor();
        },
      },
    ];
    for (const { name, go } of pages) {
      await go();
      const chip = page.locator(".backdrop-credit");
      await expect(chip, name).toBeVisible();
      // At the end of the page, where it is: scrolled there again on each
      // try, as the page may still be growing.
      await expect
        .poll(
          async () => {
            await chip.evaluate((credit) => {
              for (let box = credit.parentElement; box !== null; box = box.parentElement) {
                box.scrollTop = box.scrollHeight;
              }
              scrollTo(0, document.documentElement.scrollHeight);
            });
            return covering(page, ".backdrop-credit");
          },
          { message: name },
        )
        .toEqual([]);
      // Nor does it lie over a card: every card ends above it.
      const overlaps = await page.evaluate(() => {
        const chip = document.querySelector(".backdrop-credit")?.getBoundingClientRect();
        if (chip === undefined) return ["no credit"];
        return [...document.querySelectorAll(".panel > :not(.backdrop-credit)")]
          .filter((card) => {
            const box = card.getBoundingClientRect();
            return (
              box.height > 0 &&
              box.bottom > chip.top &&
              box.top < chip.bottom &&
              box.right > chip.left &&
              box.left < chip.right
            );
          })
          .map((card) => card.className);
      });
      expect(overlaps, name).toEqual([]);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`instrument-updated, ${theme}: the credit's words are ≥ 4.5:1 on its wash, whatever the picture`, async ({
    page,
  }) => {
    await open(page, "instrument-updated");
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    for (const ratio of await creditContrast(page)) expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

const SQUARE =
  '{"type":"Polygon","coordinates":[[[5.1,52.1],[5.1,52.11],[5.11,52.11],[5.11,52.1],[5.1,52.1]]]}';

for (const { style, updated } of VERSIONS) {
  test(`${style}: beside the map, ${updated ? "the way back on top, Run after the inputs, the error beside Run, drawing back after Change the inputs" : "as it was"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await open(page, style);
    await connect(page);
    await page
      .getByRole("button", { name: "Rotate a polygon a quarter turn", exact: true })
      .click();
    await page.locator(".map-pane canvas").waitFor();

    const back = page.getByRole("button", { name: "All processes" });
    await expect(back).toBeVisible({ visible: updated });
    const gap = await page.evaluate(() => {
      const bar = document.querySelector(".run-bar")?.getBoundingClientRect();
      const inputs = document.querySelector(".form-body")?.getBoundingClientRect();
      return bar === undefined || inputs === undefined ? Number.NaN : bar.top - inputs.bottom;
    });
    if (updated) expect(gap).toBeLessThanOrEqual(24);
    else expect(gap).toBeGreaterThan(24);

    // The server refuses: its answer is beside Run in the update, in view.
    await page.route("**/processes/breinstein-rotate/execution**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          type: "InvalidParameterValue",
          title: "Too large",
          detail: "This polygon is too large.",
        }),
      }),
    );
    await page.getByRole("button", { name: "Draw on the map" }).click();
    await page.getByRole("textbox", { name: "GeoJSON" }).fill(SQUARE);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const refused = page.getByRole("alert").filter({ hasText: "The service reported an error." });
    await expect(refused).toBeVisible();
    await expect(page.locator("form .server-error + .run-bar")).toHaveCount(updated ? 1 : 0);
    if (updated) {
      const [box, bar] = await Promise.all([
        refused.boundingBox(),
        page.locator(".run-bar").boundingBox(),
      ]);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    }

    await page.unroute("**/processes/breinstein-rotate/execution**");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: "Change the inputs" }).waitFor();
    await expect(page.getByRole("button", { name: "Choose another process" })).toHaveCount(
      updated ? 0 : 1,
    );
    await page.getByRole("button", { name: "Change the inputs" }).click();
    // The drawing comes back with its tools in the update; Instrument ends it.
    await expect(
      page
        .getByRole("toolbar", { name: "Drawing tools" })
        .getByRole("button", { name: "Add area" }),
    ).toHaveCount(updated ? 1 : 0);
  });
}

for (const { style, updated } of VERSIONS) {
  test(`${style}: a background job ${updated ? "has a link, and can be left for another process" : "keeps the page until it ends"}`, async ({
    page,
    context,
  }) => {
    // The job runs a few seconds; a busy machine reads it slowly.
    test.setTimeout(120_000);
    await requireService(`${RELAY}/healthz`, "the relay");
    const config = { relay: { url: RELAY }, presets: [], examples: [] };
    await context.route("**/config.json", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(config) }),
    );
    await page.goto(`/?style=${style}&theme=light`);
    await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Slow process", exact: true }).click();
    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("3");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.locator(".running[data-job-ref]").waitFor();

    const link = page.getByRole("textbox", { name: "The job’s link" });
    if (!updated) {
      await expect(link).toHaveCount(0);
      await expect(page.getByRole("button", { name: "All processes" })).toBeDisabled();
      return;
    }
    // The link is the page's own address, which names the job, without this
    // visitor's style and theme (#34): the receiver's page keeps its own.
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    const withoutDisplay = (address: string) => {
      const plain = new URL(address);
      plain.searchParams.delete("style");
      plain.searchParams.delete("theme");
      return plain.toString();
    };
    expect(url).toBe(withoutDisplay(page.url()));
    expect(new URL(url).searchParams.has("style")).toBe(false);
    expect(new URL(url).searchParams.has("theme")).toBe(false);
    expect(new URL(url).searchParams.get("job")).toMatch(/\S/);
    await expect(page.getByRole("button", { name: "Copy the job’s link" })).toBeVisible();

    // Another process meanwhile; the job goes on in My jobs.
    await page.getByRole("button", { name: "Start another process" }).click();
    await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();

    // Opened elsewhere, the link waits for Connect, then shows the job's results.
    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByTestId("link-notice")).toContainText("and its job");
    await other.getByRole("button", { name: "Connect", exact: true }).click();
    await other.locator('[data-output-id="slept"]').waitFor({ timeout: 45_000 });
    await expect(other.getByText("This page didn’t start this job")).toBeVisible();

    // And from My jobs, here.
    await rail(page, "Jobs").click();
    await page
      .getByTestId("my-jobs")
      .getByRole("button", { name: "Show the results" })
      .click({ timeout: 45_000 });
    await page.locator('[data-output-id="slept"]').waitFor({ timeout: 45_000 });
    expect(withoutDisplay(page.url())).toBe(url);
  });
}

test("instrument-updated: a refused Run's error is in view and has the focus, in a short window", async ({
  page,
}) => {
  // A laptop's window: the description and the form fill the panel, and the
  // Run bar stays at its foot over whatever lies under it.
  await page.setViewportSize({ width: 1432, height: 816 });
  await open(page, "instrument-updated");
  await connect(page);
  await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
  await page.locator(".map-pane canvas").waitFor();
  await page.route("**/processes/breinstein-buildings/execution**", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        type: "InvalidParameterValue",
        // Names no input: the error itself takes the focus (#11 is the other case).
        description: "The area is 38346 m across; at most 1000 m is searched",
      }),
    }),
  );
  await page.getByRole("button", { name: "Draw on the map" }).click();
  await page.getByRole("textbox", { name: "GeoJSON" }).fill(SQUARE);
  await page.getByRole("button", { name: "Run", exact: true }).click();

  const refused = page.getByRole("alert").filter({ hasText: "The service reported an error." });
  await expect(refused).toBeVisible();
  await expect(page.locator(".server-error")).toBeFocused();
  // Wholly above the Run bar, and in the window.
  await expect
    .poll(async () => {
      const [box, bar] = await Promise.all([
        refused.boundingBox(),
        page.locator(".run-bar").boundingBox(),
      ]);
      if (box === null || bar === null) return false;
      return box.y >= 0 && box.y + box.height <= bar.y;
    })
    .toBe(true);
});

for (const { style, updated } of VERSIONS) {
  test(`${style}: the start screen ${updated ? "picks no service" : "picks the first service"} for you`, async ({
    page,
  }) => {
    await open(page, style);
    await expect(page.locator(".service-choices input[type=radio]:checked")).toHaveCount(
      updated ? 0 : 1,
    );
    if (!updated) return;
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Choose a service from the list");
    await expect(page.locator(".connect-target")).toHaveCount(0);
    await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
    await expect(page.locator(".connect-target")).toHaveText("Reference pygeoapi");
  });
}

test("instrument-updated: beside the map, Developer stays at the foot with Run; About's words are centred in its box", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1432, height: 816 });
  await open(page, "instrument-updated");
  await connect(page);
  await page.getByRole("button", { name: "Buildings in an area", exact: true }).click();
  await page.locator(".map-pane canvas").waitFor();

  const about = await page.locator("details.about").evaluate((box) => {
    const style = getComputedStyle(box);
    const inputs = document.querySelector(".form-body")?.getBoundingClientRect();
    return {
      even: style.paddingTop === style.paddingBottom,
      left: Math.round(box.getBoundingClientRect().left - (inputs?.left ?? 0)),
    };
  });
  expect(about).toEqual({ even: true, left: 0 });

  const bars = () =>
    page.evaluate(() => {
      const panel = document.querySelector("main.panel")?.getBoundingClientRect();
      const run = document.querySelector(".run-bar")?.getBoundingClientRect();
      const developer = document.querySelector("main.panel > .developer")?.getBoundingClientRect();
      if (panel === undefined || run === undefined || developer === undefined) return undefined;
      return {
        runOnDeveloper: Math.round(developer.top - run.bottom),
        developerAtFoot: Math.round(panel.bottom - developer.bottom),
        developerHeight: Math.round(developer.height),
      };
    });
  await page.locator("main.panel").evaluate((panel) => {
    panel.scrollTo(0, 120);
  });
  expect(await bars()).toEqual({ runOnDeveloper: 0, developerAtFoot: 0, developerHeight: 45 });

  // Opened, it keeps its place and a fixed height, and scrolls within.
  await page.locator("details.developer > summary").click();
  const opened = await bars();
  expect(opened?.runOnDeveloper).toBe(0);
  expect(opened?.developerAtFoot).toBe(0);
  expect(opened?.developerHeight).toBe(Math.round(816 * 0.4));
});

for (const { style, updated } of VERSIONS) {
  test(`${style}: the map is ${updated ? "the world, from OpenFreeMap, falling back to PDOK" : "PDOK's Netherlands"}`, async ({
    page,
  }) => {
    await open(page, style);
    let asked = 0;
    if (updated) {
      // OpenFreeMap can't be reached: the map falls back to PDOK's.
      await page.route("https://tiles.openfreemap.org/**", (route) => {
        asked += 1;
        return route.fulfill({ status: 503, body: "" });
      });
    }
    await connect(page);
    await page
      .getByRole("button", { name: "Rotate a polygon a quarter turn", exact: true })
      .click();
    await expect(page.locator(".map-canvas")).toHaveAttribute(
      "aria-label",
      updated ? "Map of the world (OpenFreeMap)" : "Map of the Netherlands (BRT-Achtergrondkaart)",
    );
    await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText("Kadaster");
    expect(asked > 0).toBe(updated);
    // Drawing still works over the fallback.
    await page.getByRole("button", { name: "Draw on the map" }).click();
    await expect(
      page
        .getByRole("toolbar", { name: "Drawing tools" })
        .getByRole("button", { name: "Add area" }),
    ).toBeVisible();
  });
}

for (const size of [
  { width: 1432, height: 816 },
  { width: 390, height: 844 },
]) {
  test(`instrument-updated at ${String(size.width)}px: "Change service" is in the list's top right corner`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await open(page, "instrument-updated");
    await connect(page);
    const place = await page.getByRole("button", { name: "Change service" }).evaluate((button) => {
      const own = button.getBoundingClientRect();
      const screen = button.closest(".process-list-screen");
      const heading = screen?.querySelector("h2")?.getBoundingClientRect();
      const words = button.parentElement?.getBoundingClientRect();
      if (screen === null || screen === undefined || heading === undefined || words === undefined) {
        return undefined;
      }
      const box = screen.getBoundingClientRect();
      const edge = getComputedStyle(screen);
      // Inside the card's padding and its edge.
      const padRight =
        Number.parseFloat(edge.paddingRight) + Number.parseFloat(edge.borderRightWidth);
      return {
        right: Math.round(box.right - padRight - own.right),
        aboveHeading: own.bottom <= heading.top,
        firstLine: Math.round(own.top - words.top) <= 0,
      };
    });
    expect(place).toEqual({ right: 0, aboveHeading: true, firstLine: true });
  });
}

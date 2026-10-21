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
  await page.goto(`/?style=${style}&theme=light`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

async function connect(page: Page) {
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
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
        page.getByRole("complementary", { name: "About" }).getByText("Where your requests go"),
      ).toBeVisible();
    });

    test(`an open panel ${updated ? "dims" : "doesn't dim"} the page behind it`, async ({
      page,
    }) => {
      await open(page, style);
      await rail(page, "Examples").click();
      await expect(page.getByRole("complementary", { name: "Examples" })).toBeVisible();
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
      await page.getByRole("button", { name: "Choose another process" }).click();
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
      const picture = await page
        .locator(".layout-single")
        .evaluate((layout) => getComputedStyle(layout).backgroundImage);
      expect(picture.includes("europe-")).toBe(updated);
      await expect(page.locator(".backdrop-credit")).toBeVisible({ visible: updated });
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

      await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page.getByRole("button", { name: "Change the inputs" }).waitFor();
      const copyOutput = page.getByRole("button", { name: "Copy result", exact: true });
      const copyInputs = page.getByRole("button", { name: "Copy inputs", exact: true });
      if (!updated) {
        await expect(copyOutput).toHaveCount(0);
        await expect(copyInputs).toHaveCount(0);
        return;
      }
      const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
      await copyOutput.click();
      await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
      expect(await clipboard()).toBe('{\n\t"id": "echo",\n\t"value": "Hello Geonovum!"\n}');
      await copyInputs.click();
      await expect.poll(clipboard).toBe('{\n\t"name": "Geonovum"\n}');
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
    await page.getByRole("radio", { name: /pygeoapi-cors/ }).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Slow process", exact: true }).click();
    await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("1");
    await page.getByRole("checkbox", { name: "Run in the background" }).check();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.locator('[data-output-id="slept"]').waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Choose another process" }).click();

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

test("instrument-updated: About as a box like Developer, the way back a button, the credit in the corner, Copy an icon", async ({
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
  expect(await boxOf("details.about")).toEqual(await boxOf("details.developer"));

  const back = page.getByRole("button", { name: "All processes" });
  expect(await back.evaluate((button) => getComputedStyle(button).borderTopStyle)).toBe("solid");

  // A short page: the credit in the corner, 12px from the window's edges.
  const credit = await page.locator(".backdrop-credit").evaluate((chip) => {
    const box = chip.getBoundingClientRect();
    return { right: innerWidth - box.right, bottom: innerHeight - box.bottom };
  });
  expect(credit).toEqual({ right: 12, bottom: 12 });

  await page.getByRole("textbox", { name: /Name/ }).fill("hello");
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
  for (const name of ["Copy result", "Copy inputs"]) {
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

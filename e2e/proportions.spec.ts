/**
 * Proportions and corner radii, in both versions of Instrument (ADR 0002):
 * edges that meet, one height per kind of button, one panel width, bars that
 * stay straight at a rounded corner. What only the update changes is checked
 * to be absent from Instrument as it is.
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

async function open(page: Page, style: string, more = "") {
  await page.route("**/config.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        relay: null,
        presets: [
          { title: "Reference pygeoapi", url: SERVICE },
          { title: "Second pygeoapi", url: "https://second.example.test" },
        ],
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
  // The updated Instrument's world map is OpenFreeMap's: a plain stand-in.
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(WORLD_STAND_IN) }),
  );
  await page.goto(`/?style=${style}&theme=light${more}`);
  await expect(page.getByRole("heading", { level: 2, name: "Connect to a service" })).toBeVisible();
}

async function connect(page: Page) {
  await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hello World", exact: true })).toBeVisible();
}

/** The bar drawn beside a chosen item: its own element, inset from top and bottom. */
function barOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const bar = getComputedStyle(element, "::before");
      return {
        shadow: getComputedStyle(element).boxShadow,
        content: bar.content,
        width: bar.width,
        top: bar.top,
        bottom: bar.bottom,
      };
    });
}

/**
 * Every visible button by its role, with its height and text size. Rows,
 * links, icons, the rail and the map's own controls size themselves.
 */
function buttonsByRole(page: Page, updated: boolean) {
  return page.evaluate((updated) => {
    const own =
      ".rail-item, .appearance-button, .link, .copy-button, .panel-close, .example-card, .example-row, .filter, .image-open, [class*='maplibregl']";
    const compact = updated
      ? ":is(.geometry, .bbox) .actions button, :is(.form-body, .clear-form) button"
      : ":is(.geometry, .bbox) .actions button";
    return [...document.querySelectorAll("button")]
      .filter(
        (button) =>
          button.checkVisibility({ visibilityProperty: true }) &&
          button.getBoundingClientRect().width > 0 &&
          !button.matches(own),
      )
      .map((button) => ({
        name: (button.getAttribute("aria-label") ?? button.textContent ?? "").trim(),
        role: button.matches(".primary")
          ? ("primary" as const)
          : button.matches(compact)
            ? ("compact" as const)
            : ("secondary" as const),
        height: Math.round(button.getBoundingClientRect().height * 10) / 10,
        size: getComputedStyle(button).fontSize,
      }));
  }, updated);
}

const SIZES = {
  primary: { height: 48, size: "15px" },
  secondary: { height: 40, size: "13px" },
  compact: { height: 36, size: "13px" },
} as const;

/** Each button is its role's size, and none is a size that went: 38, 40.4, 46. */
async function expectButtonSizes(page: Page, updated: boolean, where: string) {
  const buttons = await buttonsByRole(page, updated);
  expect(buttons.length, where).toBeGreaterThan(0);
  for (const button of buttons) {
    const label = `${where}: ${button.name} (${button.role})`;
    expect([38, 40.4, 46], label).not.toContain(button.height);
    expect({ height: button.height, size: button.size }, label).toEqual(SIZES[button.role]);
  }
  return buttons;
}

test.describe("proportions", () => {
  test.beforeEach(async ({ page }) => {
    await requireService(`${PYGEOAPI}/?f=json`, "pygeoapi :5080");
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  for (const { style, updated } of VERSIONS) {
    test.describe(updated ? "updated" : "as it is", () => {
      test("a chosen item's bar stays straight at a rounded corner (#1)", async ({ page }) => {
        await open(page, style);
        await page.getByRole("radio", { name: /Reference pygeoapi/ }).check();
        for (const selector of [
          ".rail-item[aria-current='page']",
          "label.choice-card:has(input:checked)",
        ]) {
          const bar = await barOf(page, selector);
          expect(bar.shadow, selector).toBe("none");
          expect(bar.content, selector).toBe('""');
          expect(bar.width, selector).toBe("2px");
          expect(bar.top, selector).toBe("8px");
          expect(bar.bottom, selector).toBe("8px");
        }
      });

      test(`corners ${updated ? "step down" : "stay as they were"} from card to tag (#2)`, async ({
        page,
      }) => {
        await open(page, style);
        const radii = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          return ["--r-card", "--r-item", "--r-control", "--r-tag"].map((name) =>
            root.getPropertyValue(name).trim(),
          );
        });
        expect(radii).toEqual(
          updated ? ["8px", "6px", "4px", "2px"] : ["6px", "6px", "4px", "4px"],
        );
      });

      test("the address row ends where the lists do, its error too (#3)", async ({ page }) => {
        await open(page, style);
        const right = (selector: string) =>
          page
            .locator(selector)
            .first()
            .evaluate((element) => Math.round(element.getBoundingClientRect().right));
        const edge = await right(".service-choices");
        expect(await right(".input-with-button button")).toBe(edge);
        expect(await right(".featured-examples")).toBe(edge);

        await page.route("https://unreachable.example.test/**", (route) => route.abort());
        await page.getByRole("textbox").first().fill("https://unreachable.example.test");
        await page.getByRole("button", { name: "Connect", exact: true }).click();
        await expect(page.locator(".address-field .error-box")).toBeVisible();
        expect(await right(".address-field .error-box")).toBe(edge);
      });

      test("buttons are one size per role, on a result and beside the map (#4)", async ({
        page,
      }) => {
        await open(page, style);
        await expectButtonSizes(page, updated, "start");
        await connect(page);
        await page.getByRole("button", { name: "Hello World", exact: true }).click();
        await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
        const form = await expectButtonSizes(page, updated, "form");
        expect(form.find((button) => button.name === "Run")?.role).toBe("primary");
        await page.getByRole("button", { name: "Run", exact: true }).click();
        await page.getByRole("button", { name: "Change the inputs" }).waitFor();
        const result = await expectButtonSizes(page, updated, "result");
        expect(result.filter((button) => button.role === "secondary").length).toBeGreaterThan(1);

        await page.getByRole("button", { name: "Processes", exact: true }).click();
        await page.getByRole("button", { name: "Bounding box to feature", exact: true }).click();
        await page.locator(".map-pane canvas").waitFor();
        const beside = await expectButtonSizes(page, updated, "beside the map");
        expect(beside.filter((button) => button.role === "compact").length).toBeGreaterThan(0);
        expect(beside.find((button) => button.name === "Run")?.role).toBe("primary");
      });

      test("beside the map, a box's coordinates fit: labels on one line, buttons in one row (#5)", async ({
        page,
      }) => {
        await open(page, style);
        await connect(page);
        await page.getByRole("button", { name: "Bounding box to feature", exact: true }).click();
        await page.locator(".map-pane canvas").waitFor();
        const box = page.locator(".bbox").first();
        const lines = await box.locator("label").evaluateAll((labels) =>
          labels
            .filter((label) => /longitude|latitude/i.test(label.textContent ?? ""))
            .map((label) => {
              const range = document.createRange();
              range.selectNodeContents(label);
              const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
              return { label: label.textContent, lines: tops.size };
            }),
        );
        expect(lines).toHaveLength(4);
        for (const { label, lines: count } of lines) expect(count, label ?? "").toBe(1);
        const tops = await box
          .locator(".actions button")
          .evaluateAll((buttons) =>
            buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
          );
        expect(tops.length).toBe(3);
        expect(new Set(tops).size).toBe(1);
      });

      test(`the request log is ${updated ? "open in the Developer section" : "folded, clear of the scale bar"} (#7, #8)`, async ({
        page,
      }) => {
        // The update's request log is in the Developer section: `?developer`.
        await open(page, style, updated ? "&developer" : "");
        await connect(page);
        await page.getByRole("button", { name: "Bounding box to feature", exact: true }).click();
        await page.locator(".map-pane canvas").waitFor();
        for (const [label, value] of [
          ["West", "4.2"],
          ["South", "52.0"],
          ["East", "4.4"],
          ["North", "52.1"],
        ] as const) {
          await page.getByRole("textbox", { name: new RegExp(`^${label}`) }).fill(value);
        }
        await page.getByRole("button", { name: "Run", exact: true }).click();
        await page.getByRole("button", { name: "Change the inputs" }).waitFor();

        const developer = page.locator("details.developer");
        if (updated && !(await developer.evaluate((fold) => (fold as HTMLDetailsElement).open))) {
          await developer.locator("> summary").click();
        }
        const log = page.getByRole("region", { name: "Requests to this service", exact: true });
        await expect(log).toBeVisible();
        await expect(log.locator("summary")).toHaveText(/^Requests to this service \(\d+\)$/);
        const details = log.locator("details");
        await expect(details).toHaveJSProperty("open", updated);
        if (updated) {
          await expect(page.locator("details.developer .request-log li").first()).toBeVisible();
          return;
        }
        const overlap = await page.evaluate(() => {
          const a = document.querySelector(".request-log")?.getBoundingClientRect();
          const b = document.querySelector(".maplibregl-ctrl-scale")?.getBoundingClientRect();
          if (a === undefined || b === undefined) return undefined;
          return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        });
        expect(overlap).toBe(false);
        await log.locator("summary").click();
        await expect(log.locator("li").first()).toBeVisible();
      });

      test("radios and checkboxes are in the main colour (#9)", async ({ page }) => {
        await open(page, style);
        const accent = await page.evaluate(() => {
          // --accent resolved to a colour, as accent-color computes it.
          const probe = document.createElement("span");
          probe.style.color = "var(--accent)";
          document.body.append(probe);
          const colour = getComputedStyle(probe).color;
          probe.remove();
          return colour;
        });
        const radio = page.getByRole("radio", { name: /Reference pygeoapi/ });
        expect(await radio.evaluate((input) => getComputedStyle(input).accentColor)).toBe(accent);
        await connect(page);
        await page.getByRole("button", { name: "Hello World", exact: true }).click();
        const box = page.getByRole("checkbox", { name: "Run in the background" });
        expect(await box.evaluate((input) => getComputedStyle(input).accentColor)).toBe(accent);
        await page
          .getByRole("banner")
          .getByRole("button", { name: /Appearance/ })
          .click();
        const night = page.getByRole("radio", { name: "Off", exact: true });
        expect(await night.evaluate((input) => getComputedStyle(input).accentColor)).toBe(accent);
      });

      test("Examples, My jobs and About open alike: width, title and where it sits (#10)", async ({
        page,
      }) => {
        await open(page, style);
        const rail = page.getByRole("banner");
        const seen = [];
        for (const [item, title] of [
          [/^Examples/, "Examples"],
          [/^Jobs/, "My jobs"],
          [/^About/, "About"],
        ] as const) {
          await rail.getByRole("button", { name: item }).click();
          const panel = page.getByRole("dialog", { name: title });
          await expect(panel).toBeVisible();
          // Once the slide is over.
          await expect
            .poll(() => panel.evaluate((element) => getComputedStyle(element).transform))
            .toBe("none");
          seen.push(
            await panel.evaluate((element) => {
              const heading = element.querySelector("h2");
              return {
                width: Math.round(element.getBoundingClientRect().width),
                size: heading === null ? "" : getComputedStyle(heading).fontSize,
                top: Math.round(heading?.getBoundingClientRect().top ?? 0),
              };
            }),
          );
          await page.keyboard.press("Escape");
          await expect(panel).toBeHidden();
        }
        expect(seen[0]?.width).toBe(420);
        expect(seen[0]?.size).toBe("20px");
        expect(seen[1]).toEqual(seen[0]);
        expect(seen[2]).toEqual(seen[0]);
      });

      test(`on a phone, ${updated ? "every page has one frame" : "the frame is as it was"} (#12)`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, style);
        const padding = (selector: string) =>
          page
            .locator(selector)
            .first()
            .evaluate((element) => {
              const style = getComputedStyle(element);
              return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
            });
        expect(await padding(".layout-single .panel")).toEqual(Array(4).fill("12px"));
        expect(await padding(".start")).toEqual(
          updated ? Array(4).fill("16px") : ["20px", "18px", "20px", "18px"],
        );

        await connect(page);
        await page.getByRole("button", { name: "Hello World", exact: true }).click();
        await page.getByRole("textbox", { name: /Name/ }).fill("Geonovum");
        await page.getByRole("button", { name: "Run", exact: true }).click();
        await page.getByRole("button", { name: "Change the inputs" }).waitFor();
        const panel = await padding(".layout-single .panel");
        const card = await padding(".layout-single .process-screen");
        expect([panel[1], panel[3]]).toEqual(updated ? ["12px", "12px"] : ["20px", "20px"]);
        expect(card).toEqual(updated ? Array(4).fill("16px") : ["20px", "24px", "20px", "24px"]);

        // The JSON, unfolded where the update shows the plain value first.
        const json = page.locator(".result details").first();
        if (!(await json.evaluate((fold) => (fold as HTMLDetailsElement).open))) {
          await json.locator("> summary").click();
        }
        const widths = await page.evaluate(() => ({
          result: Math.round(document.querySelector(".result")?.getBoundingClientRect().width ?? 0),
          json: Math.round(
            document.querySelector(".result pre")?.getBoundingClientRect().width ?? 0,
          ),
        }));
        expect(widths).toEqual(updated ? { result: 332, json: 306 } : { result: 300, json: 274 });
      });

      test("My jobs' buttons are one size (#4)", async ({ page }) => {
        await requireService(`${RELAY}/healthz`, "the relay");
        // Through the relay: only it can name a job pygeoapi starts for a page.
        await page.goto(`/?style=${style}&theme=light`);
        await page.evaluate(() => {
          localStorage.clear();
        });
        await page.reload();
        await page.getByRole("radio", { name: /^pygeoapi[- ]cors /i }).check();
        await page.getByRole("button", { name: "Connect", exact: true }).click();
        await page.getByRole("button", { name: "Slow process", exact: true }).click();
        await page.getByRole("textbox", { name: "Seconds (optional)" }).fill("1");
        await page.getByRole("checkbox", { name: "Run in the background" }).check();
        await page.getByRole("button", { name: "Run", exact: true }).click();
        await expect(page.locator('[data-output-id="slept"]')).toBeVisible({ timeout: 30_000 });
        await page.getByRole("banner").getByRole("button", { name: /^Jobs/ }).click();
        await expect(page.getByTestId("my-jobs").locator("[data-job-row]")).toHaveCount(1);
        const buttons = await expectButtonSizes(page, updated, "My jobs");
        expect(buttons.map((button) => button.name)).toContain("Remove from list");
      });
    });
  }
});

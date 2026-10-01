/**
 * A map failure stays on the map (review W3): the rest of the page renders on,
 * and where the map was, a message says what happened.
 */

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { MapBoundary } from "../../src/app/MapBoundary.js";

function BrokenMap(): null {
  useEffect(() => {
    throw new RangeError("Maximum call stack size exceeded");
  }, []);
  return null;
}

describe("MapBoundary", () => {
  it("catches what the map throws in an effect, and leaves the rest of the page", async () => {
    const container = document.createElement("div");
    const uncaught: unknown[] = [];
    const caught: unknown[] = [];
    const root = createRoot(container, {
      onUncaughtError: (error) => {
        uncaught.push(error);
      },
      onCaughtError: (error) => {
        caught.push(error);
      },
    });
    await act(async () => {
      root.render(
        <main>
          <p>The form</p>
          <MapBoundary>
            <BrokenMap />
          </MapBoundary>
        </main>,
      );
      await Promise.resolve();
    });
    expect(uncaught).toEqual([]);
    expect(caught).toHaveLength(1);
    expect(container.textContent).toContain("The form");
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "The map stopped working (Maximum call stack size exceeded)",
    );
    root.unmount();
  });

  it("renders the map as it is while nothing goes wrong", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        <MapBoundary>
          <p>The map</p>
        </MapBoundary>,
      );
    });
    expect(container.textContent).toBe("The map");
    root.unmount();
  });
});

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { App } from "../src/App.js";

it("renders the core version", () => {
  const host = document.createElement("div");
  document.body.append(host);

  act(() => {
    createRoot(host).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

  expect(host.querySelector("[data-testid='core-version']")?.textContent).toContain("core ");
});

import { expect, it } from "vitest";
import { createApp } from "../src/app.js";

it("answers the health check", async () => {
  const res = await createApp().request("/healthz");
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ ok: true });
});

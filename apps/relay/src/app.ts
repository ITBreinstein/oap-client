import { Hono } from "hono";

/** The relay application, exported without a listener so tests can call it. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  return app;
}

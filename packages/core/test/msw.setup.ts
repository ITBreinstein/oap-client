import { setupServer } from "msw/node";
import type { SetupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/** Shared request-mocking server; tests add handlers with `server.use(...)`. */
export const server: SetupServer = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

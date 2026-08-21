// Bundled for the browser. The point is the bundle step itself: with
// --platform=browser, any Node built-in reaching the published bundle is a
// hard resolution failure rather than a runtime surprise for a consumer.
import { createClient, VERSION } from "@breinstein/ogcapi-processes-core";

const client = createClient({
  baseUrl: "https://example.org/ogc",
  fetch: () => Promise.resolve(new Response("{}")),
});

globalThis.__smoke = { VERSION, base: client.baseUrl.href };

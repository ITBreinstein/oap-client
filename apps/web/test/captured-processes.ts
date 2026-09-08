import BufferJson from "../../../packages/core/test/fixtures/zoo-project/processes/Buffer.json?raw";
import CentroidJson from "../../../packages/core/test/fixtures/zoo-project/processes/Centroid.json?raw";
import Ogr2OgrJson from "../../../packages/core/test/fixtures/zoo-project/processes/Ogr2Ogr.json?raw";
import echoJson from "../../../packages/core/test/fixtures/zoo-project/processes/echo.json?raw";
import longProcessJson from "../../../packages/core/test/fixtures/zoo-project/processes/longProcess.json?raw";
import { type ProcessDescription, parseDescription } from "@breinstein/oap-client";

/**
 * Process descriptions captured from a live ZOO-Project, borrowed from the
 * core's fixtures.
 *
 * Reaching into another workspace's test directory is a deliberate exception,
 * and temporary — it lasts only until the interface fetches descriptions for
 * real. The alternative was a second copy under `apps/web`, and copies of
 * captured evidence drift from what the server actually sent.
 *
 * `?raw` rather than a plain JSON import for two reasons: these files sit
 * outside `apps/web`'s `rootDir`, which a typed import would trip over, and
 * `vite/client` declares `*?raw` ambiently, so no Node types are needed here.
 * Adding those would also let `src` reach for Node APIs in a browser app.
 */
const captured = {
  Buffer: BufferJson,
  Centroid: CentroidJson,
  Ogr2Ogr: Ogr2OgrJson,
  echo: echoJson,
  longProcess: longProcessJson,
} as const;

export type CapturedProcessName = keyof typeof captured;

/** Every process in the captured set, by the fixture's own file name. */
export const capturedProcessNames = Object.keys(captured) as readonly CapturedProcessName[];

/**
 * Parsed by the core, exactly as `App` parses a live one.
 *
 * The alternative — casting the raw JSON to a hand-written interface — would
 * let these tests pass against a shape the running app never sees, which is
 * the one thing a fixture-driven test must not do.
 *
 * The URL these were captured from, so the parse resolves links against a
 * plausible base. Nothing is fetched.
 */
export function readCapturedProcess(name: CapturedProcessName): ProcessDescription {
  return parseDescription(JSON.parse(captured[name]), {
    documentUrl: `http://localhost/ogc-api/processes/${name}`,
  }).process;
}

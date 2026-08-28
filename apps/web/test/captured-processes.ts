import BufferJson from "../../../packages/core/test/fixtures/zoo-project/processes/Buffer.json?raw";
import CentroidJson from "../../../packages/core/test/fixtures/zoo-project/processes/Centroid.json?raw";
import Ogr2OgrJson from "../../../packages/core/test/fixtures/zoo-project/processes/Ogr2Ogr.json?raw";
import echoJson from "../../../packages/core/test/fixtures/zoo-project/processes/echo.json?raw";
import longProcessJson from "../../../packages/core/test/fixtures/zoo-project/processes/longProcess.json?raw";
import type { InputDescription } from "../src/inputs/ProcessInputs.js";

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

/** Only the part of a process description this interface reads so far. */
export interface CapturedProcess {
  readonly id: string;
  readonly title?: string;
  readonly inputs: Readonly<Record<string, InputDescription>>;
}

export type CapturedProcessName = keyof typeof captured;

/** Every process in the captured set, by the fixture's own file name. */
export const capturedProcessNames = Object.keys(captured) as readonly CapturedProcessName[];

export function readCapturedProcess(name: CapturedProcessName): CapturedProcess {
  return JSON.parse(captured[name]) as CapturedProcess;
}

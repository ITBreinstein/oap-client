/**
 * The real Terra Draw (1.35) and its real MapLibre adapter (1.4), on a
 * stand-in for MapLibre's `Map`: what the draw engines are tested against.
 *
 * They used to be tested against a hand-written Terra Draw stub. It accepted
 * every feature, never emitted from `clear()`, `removeFeatures()`, `setMode()`
 * or `selectFeature()`, and knew nothing of corner dots or selection handles,
 * and it hid four bugs that way (review W1, W15, W16, W17; and #24 before
 * them). So nothing of Terra Draw is faked any more. The only stand-in left is
 * the map, and each of its behaviours below copies MapLibre 6.11:
 *
 * - `addSource` / `addLayer` refuse an id that exists (`style.ts`, "already
 *   exists").
 * - After `remove()` the style is gone (`map.ts`, `delete this.style`), so the
 *   style methods throw and `getSource` answers `undefined`.
 * - `project` / `unproject` are a plain scale, 1000 px to the degree: Terra
 *   Draw only compares pixel distances, so any consistent projection does.
 *
 * Test files wire it in with two `vi.mock` calls that subclass the real
 * classes, so each instance can be reached:
 *
 * ```ts
 * vi.mock("terra-draw", async (original) =>
 *   (await import("./real-terra-draw.js")).spyOnTerraDraw(await original()),
 * );
 * vi.mock("terra-draw-maplibre-gl-adapter", async (original) =>
 *   (await import("./real-terra-draw.js")).spyOnAdapter(await original()),
 * );
 * ```
 */

import type * as TerraDrawModule from "terra-draw";
import type * as AdapterModule from "terra-draw-maplibre-gl-adapter";

type TerraDrawInstance = InstanceType<typeof TerraDrawModule.TerraDraw>;

/** Every Terra Draw made since the last {@link resetTerraDraw}, oldest first. */
const draws: TerraDrawInstance[] = [];
/** Every adapter made since the last {@link resetTerraDraw}, oldest first. */
const adapters: object[] = [];

export function spyOnTerraDraw(real: typeof TerraDrawModule): typeof TerraDrawModule {
  class TerraDraw extends real.TerraDraw {
    constructor(...args: ConstructorParameters<typeof real.TerraDraw>) {
      super(...args);
      draws.push(this);
    }
  }
  return { ...real, TerraDraw };
}

export function spyOnAdapter(real: typeof AdapterModule): typeof AdapterModule {
  class TerraDrawMapLibreGLAdapter extends real.TerraDrawMapLibreGLAdapter<unknown> {
    constructor(...args: ConstructorParameters<typeof real.TerraDrawMapLibreGLAdapter<unknown>>) {
      super(...args);
      adapters.push(this);
    }
  }
  return { ...real, TerraDrawMapLibreGLAdapter };
}

export function resetTerraDraw(): void {
  draws.length = 0;
  adapters.length = 0;
}

/** The Terra Draw the engine under test made. */
export function lastDraw(): TerraDrawInstance {
  const draw = draws.at(-1);
  if (draw === undefined) throw new Error("no Terra Draw was made");
  return draw;
}

/** A pointer at a longitude and latitude, as the adapter hands it to a mode. */
export function pointer(lng: number, lat: number) {
  return {
    lng,
    lat,
    containerX: lng * 1000,
    containerY: -lat * 1000,
    button: "left" as const,
    heldKeys: [],
    isContextMenu: false,
  };
}

type Pointer = ReturnType<typeof pointer>;

/**
 * The user's hand: what the adapter calls on the current mode for a click, a
 * move or a drag. Read afresh for every gesture, since Terra Draw registers
 * new callbacks each time its mode changes.
 */
export const user = {
  click(lng: number, lat: number): void {
    current().onMouseMove(pointer(lng, lat));
    current().onClick(pointer(lng, lat));
  },
  /** Press at `from`, move through to `to`, release. */
  drag(from: readonly [number, number], to: readonly [number, number]): void {
    const draggable = () => undefined;
    current().onMouseMove(pointer(...from));
    current().onDragStart(pointer(...from), draggable);
    current().onDrag(pointer((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), draggable);
    current().onDrag(pointer(...to), draggable);
    current().onDragEnd(pointer(...to), draggable);
  },
};

interface ModeCallbacks {
  onClick(event: Pointer): void;
  onMouseMove(event: Pointer): void;
  onDragStart(event: Pointer, setDraggability: (enabled: boolean) => void): void;
  onDrag(event: Pointer, setDraggability: (enabled: boolean) => void): void;
  onDragEnd(event: Pointer, setDraggability: (enabled: boolean) => void): void;
}

function current(): ModeCallbacks {
  const adapter = adapters.at(-1);
  if (adapter === undefined) throw new Error("no adapter was made");
  // The adapter keeps the mode's callbacks in a field its type does not
  // declare; this is the one place a test reaches for it.
  const callbacks: unknown = (adapter as { _currentModeCallbacks?: unknown })._currentModeCallbacks;
  if (typeof callbacks !== "object" || callbacks === null) throw new Error("no mode registered");
  return callbacks as ModeCallbacks;
}

/** The features Terra Draw holds that are shapes, not its own handles. */
export function drawnShapes(draw: TerraDrawInstance) {
  return draw
    .getSnapshot()
    .filter(
      (feature) =>
        !["coordinatePoint", "selectionPoint", "midPoint", "closingPoint", "snappingPoint"].some(
          (key) => feature.properties[key] === true,
        ),
    );
}

export interface FakeMap {
  /** Hand this to an engine. */
  readonly map: never;
  readonly sources: ReadonlyMap<string, unknown>;
  /** What MapView's ref cleanup does: `map.remove()`. */
  remove(): void;
}

export function fakeMap(): FakeMap {
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");
  container.append(canvas);
  const sources = new Map<string, unknown>();
  const layers = new Set<string>();
  let removed = false;
  const gone = (method: string) =>
    new TypeError(`Cannot read properties of undefined (reading '${method}')`);
  const toggle = { isEnabled: () => true, enable: () => undefined, disable: () => undefined };
  const map = {
    version: "6.11.1",
    getContainer: () => container,
    getCanvas: () => canvas,
    dragRotate: toggle,
    dragPan: toggle,
    doubleClickZoom: toggle,
    hasImage: () => false,
    addSource(id: string, spec: { data?: unknown }) {
      if (removed) throw gone("addSource");
      if (sources.has(id)) throw new Error(`Source "${id}" already exists.`);
      sources.set(id, spec.data);
    },
    getSource(id: string) {
      if (removed || !sources.has(id)) return undefined;
      return {
        setData(data: unknown) {
          sources.set(id, data);
        },
      };
    },
    addLayer(layer: { id: string }) {
      if (removed) throw gone("addLayer");
      if (layers.has(layer.id)) throw new Error(`Layer "${layer.id}" already exists.`);
      layers.add(layer.id);
    },
    removeLayer(id: string) {
      if (removed) throw gone("removeLayer");
      layers.delete(id);
    },
    removeSource(id: string) {
      if (removed) throw gone("removeSource");
      sources.delete(id);
    },
    moveLayer: () => undefined,
    project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 1000, y: -lat * 1000 }),
    unproject: ({ x, y }: { x: number; y: number }) => ({ lng: x / 1000, lat: -y / 1000 }),
  };
  return {
    map: map as never,
    sources,
    remove() {
      removed = true;
    },
  };
}

/**
 * The part of a MapLibre map the draw hooks read before they start a draw
 * mode: whether its style is in (`getStyle()` returns nothing until it is),
 * and the event that says it has come in (review W30). Nothing else; an
 * engine stub is handed this as its map.
 */

type Listener = () => void;

export interface StyleMap {
  /** Hand this to a hook. */
  readonly map: never;
  /** The style comes in, and `style.load` fires. */
  load(): void;
  /** Listeners still waiting. */
  listening(): number;
}

export function styleMap({ loaded = true }: { loaded?: boolean } = {}): StyleMap {
  let isLoaded = loaded;
  const listeners = new Map<string, Set<Listener>>();
  const map = {
    getStyle: () => (isLoaded ? { version: 8, sources: {}, layers: [] } : undefined),
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
    },
    remove: () => undefined,
  };
  return {
    map: map as never,
    load() {
      isLoaded = true;
      for (const listener of [...(listeners.get("style.load") ?? [])]) listener();
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

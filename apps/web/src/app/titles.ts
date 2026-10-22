/**
 * The names a visitor knows things by (#43): a process's title rather than
 * its id, and a service's title rather than its address. Learned from what
 * this visit has read: a service's landing page and process list, and the
 * examples and presets in `config.json`. Kept in memory only.
 */

/** What this visit has learned, by service address (without trailing slashes). */
export interface Titles {
  readonly services: ReadonlyMap<string, string>;
  /** By {@link titleKey}. */
  readonly processes: ReadonlyMap<string, string>;
}

export const NO_TITLES: Titles = { services: new Map(), processes: new Map() };

function plain(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The key a process's title is kept under. */
export function titleKey(baseUrl: string, processId: string): string {
  return `${plain(baseUrl)}\n${processId}`;
}

/**
 * The titles with what one service says of itself and its processes: the
 * same object when there is nothing new, so it can be called while
 * rendering.
 */
export function learnTitles(
  titles: Titles,
  baseUrl: string,
  serviceTitle: string | undefined,
  processes: readonly { readonly id: string; readonly title?: string | undefined }[],
): Titles {
  const service = plain(baseUrl);
  const newService =
    serviceTitle !== undefined && titles.services.get(service) !== serviceTitle
      ? serviceTitle
      : undefined;
  const newProcesses = processes.filter(
    (process): process is { readonly id: string; readonly title: string } =>
      process.title !== undefined &&
      titles.processes.get(titleKey(service, process.id)) !== process.title,
  );
  if (newService === undefined && newProcesses.length === 0) return titles;
  return {
    services:
      newService === undefined
        ? titles.services
        : new Map(titles.services).set(service, newService),
    processes:
      newProcesses.length === 0
        ? titles.processes
        : new Map([
            ...titles.processes,
            ...newProcesses.map((process): [string, string] => [
              titleKey(service, process.id),
              process.title,
            ]),
          ]),
  };
}

/** The host of an address, or the address when it has none. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A service's name: its own title, read this visit; else the title its
 * preset gives it; else its host.
 */
export function serviceTitle(
  titles: Titles,
  presets: readonly { readonly title: string; readonly url: string }[],
  baseUrl: string,
): string {
  return (
    titles.services.get(plain(baseUrl)) ??
    presets.find((preset) => plain(preset.url) === plain(baseUrl))?.title ??
    hostOf(baseUrl)
  );
}

/**
 * A process's name: its title, read this visit or given by an example;
 * else its id.
 */
export function processTitle(
  titles: Titles,
  examples: readonly {
    readonly service: string;
    readonly process: string;
    readonly title: string;
  }[],
  baseUrl: string,
  processId: string,
): string {
  return (
    titles.processes.get(titleKey(baseUrl, processId)) ??
    examples.find(
      (example) => plain(example.service) === plain(baseUrl) && example.process === processId,
    )?.title ??
    processId
  );
}

/** Where the page is, for its tab's title (#37). */
export type TitledPlace =
  | { readonly stage: "choose-endpoint" }
  | { readonly stage: "connected"; readonly service: string }
  | {
      readonly stage: "process" | "running" | "result";
      readonly service: string;
      readonly process: string;
    };

/**
 * The browser tab's title for a place (#37): what is on screen first, so a
 * row of tabs tells them apart, and the service last.
 */
export function pageTitle(place: TitledPlace): string {
  switch (place.stage) {
    case "choose-endpoint":
      return "Connect · Breinstein";
    case "connected":
      return `Processes · ${place.service}`;
    case "process":
    case "running":
      return `${place.process} · ${place.service}`;
    case "result":
      return `${place.process}: result · ${place.service}`;
  }
}

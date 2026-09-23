/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The relay's URL, as the browser reaches it. Unset means no relay: every
   * request goes straight to the OGC server and jobs are found by polling.
   */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * STYLE TRIAL: whether the page is the updated Instrument, for the few
 * things the stylesheets can't switch on their own: what a field fills in,
 * how JSON is laid out, which markup a list uses. Everything that is only a
 * look stays in `style-instrument-updated.css`. Once one version is chosen,
 * keep its branch wherever `useUpdated` is read, and delete this file
 * (ADR 0002).
 */

import { createContext, useContext } from "react";

export const UpdatedContext = createContext(false);

export function useUpdated(): boolean {
  return useContext(UpdatedContext);
}

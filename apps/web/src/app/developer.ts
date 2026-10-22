/**
 * Whether the page was opened with `?developer` (#43): the technical words a
 * visitor is spared in the updated Instrument (a request header, a CRS, a
 * job's id, what was recorded) are shown again.
 */

import { createContext, useContext } from "react";

export const DeveloperContext = createContext(false);

export function useDeveloper(): boolean {
  return useContext(DeveloperContext);
}

/**
 * STYLE TRIAL: whether this text is one the updated Instrument keeps from a
 * visitor: in the update, without `?developer`.
 */
export function useSpared(updated: boolean): boolean {
  const developer = useDeveloper();
  return updated && !developer;
}

/**
 * Text without the page's sentence about what it recorded: "The attempt has
 * been recorded." and its longer forms. What it says stays true: the
 * observation is recorded all the same; only the sentence is spared.
 */
export function withoutRecordNote(text: string): string {
  return text
    .replace(/\s*The attempt has been recorded[^.]*\./g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

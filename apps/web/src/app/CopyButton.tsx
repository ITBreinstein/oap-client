/**
 * STYLE TRIAL (updated Instrument): copies text to the clipboard. An icon
 * button, set in the corner of what it copies; a tick for a moment after.
 * Its name says what it copies ("Copy echo"), and a screen reader hears
 * "Copied". Where the clipboard refuses (an insecure page, a denied
 * permission), it says to select the text instead.
 */

import { useEffect, useState } from "react";

const COPY = "M9 9h10v12H9zM5 15V3h10";
const DONE = "M5 12.5l4.5 4.5L19 7.5";

export function CopyButton({
  text,
  name,
}: {
  /** What to copy, made when the button is pressed. */
  readonly text: () => string;
  /** The button's name for a screen reader and its tooltip: "Copy echo". */
  readonly name: string;
}) {
  const [said, setSaid] = useState<"copied" | "failed" | undefined>();
  useEffect(() => {
    if (said === undefined) return undefined;
    const timer = setTimeout(() => {
      setSaid(undefined);
    }, 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [said]);
  return (
    <span className="copy">
      <button
        type="button"
        className="copy-button"
        aria-label={name}
        title={said === "copied" ? "Copied" : name}
        data-copied={said === "copied" ? true : undefined}
        onClick={() => {
          navigator.clipboard.writeText(text()).then(
            () => {
              setSaid("copied");
            },
            () => {
              setSaid("failed");
            },
          );
        }}
      >
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d={said === "copied" ? DONE : COPY}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span
        className={said === "failed" ? "copy-status" : "copy-status visually-hidden"}
        role="status"
      >
        {said === "copied" ? "Copied" : said === "failed" ? "Couldn’t copy: select the text" : ""}
      </span>
    </span>
  );
}

/**
 * STYLE TRIAL (updated Instrument): copies text to the clipboard, and says
 * so beside the button for a moment. Where the clipboard refuses (an
 * insecure page, a denied permission), it says to select the text instead.
 */

import { useEffect, useState } from "react";

export function CopyButton({
  text,
  label,
  name,
}: {
  /** What to copy, made when the button is pressed. */
  readonly text: () => string;
  /** The button's words. */
  readonly label: string;
  /** Its name for a screen reader, starting with the words: "Copy echo". */
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
        className="secondary copy-button"
        aria-label={name}
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
        {label}
      </button>
      <span className="copy-status" role="status">
        {said === "copied" ? "Copied" : said === "failed" ? "Couldn’t copy: select the text" : ""}
      </span>
    </span>
  );
}

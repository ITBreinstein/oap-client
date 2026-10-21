/**
 * STYLE TRIAL (updated Instrument): copies text to the clipboard. An icon
 * button, set in the corner of what it copies; a tick for a moment after.
 * Its name says what it copies ("Copy result"), a tooltip shows the same
 * words on hover and keyboard focus, and a screen reader hears "Copied".
 * Where the clipboard refuses (an insecure page, a denied permission), it
 * says to select the text instead.
 *
 * The button is 44 × 44 px to press; the square drawn round the icon is
 * smaller. Escape hides the tooltip until the pointer or focus comes back.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useUpdated } from "./variant.js";

const COPY = "M9 9h10v12H9zM5 15V3h10";
const DONE = "M5 12.5l4.5 4.5L19 7.5";

export function CopyButton({
  text,
  name,
}: {
  /** What to copy, made when the button is pressed. */
  readonly text: () => string;
  /** The button's name for a screen reader and its tooltip: "Copy result". */
  readonly name: string;
}) {
  const [said, setSaid] = useState<"copied" | "failed" | undefined>();
  const [tipHidden, setTipHidden] = useState(false);
  useEffect(() => {
    if (said === undefined) return undefined;
    const timer = setTimeout(() => {
      setSaid(undefined);
    }, 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [said]);
  // Escape hides a tooltip shown by hover too, wherever the focus is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTipHidden(true);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <span
      className="copy"
      data-tip-hidden={tipHidden ? true : undefined}
      onMouseEnter={() => {
        setTipHidden(false);
      }}
    >
      <button
        type="button"
        className="copy-button"
        aria-label={name}
        data-copied={said === "copied" ? true : undefined}
        onFocus={() => {
          setTipHidden(false);
        }}
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
        <span className="copy-face">
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
        </span>
      </button>
      {/* The button's name already says it to a screen reader. */}
      <span className="copy-tip" aria-hidden="true">
        {name}
      </span>
      <span
        className={said === "failed" ? "copy-status" : "copy-status visually-hidden"}
        role="status"
      >
        {said === "copied" ? "Copied" : said === "failed" ? "Couldn’t copy: select the text" : ""}
      </span>
    </span>
  );
}

/**
 * A text box of the form with Copy in its corner, in the updated Instrument;
 * the box alone in Instrument as it is. Copy shows once there is text. A
 * span, as some boxes sit in a `<p>`.
 */
export function CopyField({
  text,
  name,
  multiline = false,
  children,
}: {
  /** What the box holds, as it shows it. */
  readonly text: string;
  /** "Copy Name": the button's name and tooltip. */
  readonly name: string;
  /** A textarea: Copy in its top corner, not centred on one line. */
  readonly multiline?: boolean;
  readonly children: ReactNode;
}) {
  const updated = useUpdated();
  if (!updated) return children;
  return (
    <span className="copy-field" data-multiline={multiline ? true : undefined}>
      {children}
      {text !== "" && <CopyButton name={name} text={() => text} />}
    </span>
  );
}

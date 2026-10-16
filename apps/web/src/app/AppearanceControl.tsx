/**
 * The Appearance control: a button, and a small popover with two groups of
 * radio buttons. A change applies at once; there is no Apply. Escape closes
 * the popover and puts focus back on the button, as does choosing the button
 * again; a click elsewhere closes it and leaves focus where it went.
 *
 * The "Style" group is a trial: once one is chosen, delete that fieldset
 * (and `STYLE_LABELS`), and keep "Night mode"
 * (`docs/adr/0002-switchable-styles.md`).
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  STYLE_NAMES,
  THEME_PREFERENCES,
  type Appearance,
  type StyleName,
  type ThemePreference,
} from "./appearance.js";

// STYLE TRIAL: delete with the "Style" fieldset once a style is chosen.
const STYLE_LABELS: Readonly<Record<StyleName, string>> = {
  instrument: "Instrument",
  "instrument-updated": "Instrument (updated)",
};

const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: "Follow system",
  light: "Off",
  dark: "On",
};

export interface AppearanceControlProps {
  readonly appearance: Appearance;
  readonly onStyle: (style: StyleName) => void;
  readonly onTheme: (theme: ThemePreference) => void;
  /** Extra class on the wrapper, so the frame can place it (header or rail). */
  readonly className?: string | undefined;
}

/** Half a circle filled: the usual sign for light and dark. */
export function AppearanceIcon() {
  return (
    <svg className="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
    </svg>
  );
}

export function AppearanceControl(props: AppearanceControlProps) {
  const { appearance, onStyle, onTheme, className } = props;
  const base = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  // Into the popover on opening, onto the choice already made.
  useEffect(() => {
    if (open) popover.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, [open]);

  // A press anywhere else closes it. Focus stays where that press put it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popover.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div
      className={`appearance${className === undefined ? "" : ` ${className}`}`}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="appearance-button"
        aria-expanded={open}
        aria-controls={open ? `${base}-popover` : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <AppearanceIcon />
        <span className="appearance-label">Appearance</span>
      </button>
      {open && (
        <div
          ref={popover}
          id={`${base}-popover`}
          className="appearance-popover"
          role="dialog"
          aria-label="Appearance"
        >
          {/* STYLE TRIAL: delete this fieldset once a style is chosen. */}
          <fieldset>
            <legend>Style</legend>
            {STYLE_NAMES.map((style) => (
              <label key={style} className="choice">
                <input
                  type="radio"
                  name={`${base}-style`}
                  value={style}
                  checked={appearance.style === style}
                  onChange={() => {
                    onStyle(style);
                  }}
                />{" "}
                {STYLE_LABELS[style]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Night mode</legend>
            {THEME_PREFERENCES.map((theme) => (
              <label key={theme} className="choice">
                <input
                  type="radio"
                  name={`${base}-theme`}
                  value={theme}
                  checked={appearance.theme === theme}
                  onChange={() => {
                    onTheme(theme);
                  }}
                />{" "}
                {THEME_LABELS[theme]}
              </label>
            ))}
          </fieldset>
        </div>
      )}
    </div>
  );
}

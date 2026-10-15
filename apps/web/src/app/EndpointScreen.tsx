/**
 * The start screen (S2, T8): choose a service — a configured endpoint from
 * the relay, a preset from the site's `config.json`, or any address typed
 * in — and connect. One form, one Connect button. A preset is reached exactly
 * as a typed address is: directly.
 *
 * It is the first thing a visitor sees, so it also says what the page is for,
 * what happens after Connect, and which services can work from a web page.
 * The address field and its Connect button sit on one line, like a search
 * box. The known services, when there are any, are listed under it, and
 * Connect then says which one it will open. The examples follow the card, and
 * how it works and which services work are disclosures after them, so a first
 * screen shows the card and the examples.
 */

import { useId, useState, type ReactNode, type SyntheticEvent } from "react";
import type { Preset } from "../config/runtime-config.js";
import type { RelayEndpoint } from "../relay/contract.js";
import { typedEndpoint } from "./run.js";
import type { EndpointRef, WorkflowError } from "./workflow.js";
import { ErrorMessage } from "./ErrorMessage.js";

const TYPED = "typed";
const presetKey = (index: number): string => `preset:${String(index)}`;

export interface EndpointScreenProps {
  readonly configured: readonly RelayEndpoint[];
  readonly configuredError: string | undefined;
  readonly presets: readonly Preset[];
  readonly connecting: EndpointRef | undefined;
  readonly error: WorkflowError | undefined;
  /** True when the site runs without the relay: the screen then says what that rules out. */
  readonly staticOnly: boolean;
  readonly onConnect: (endpoint: EndpointRef) => void;
  /** The featured examples, shown under the connect card. */
  readonly examples?: ReactNode;
}

/** The four stages of the workflow, in the words a first-time visitor needs. */
const STEPS: readonly { readonly title: string; readonly text: string }[] = [
  { title: "Connect", text: "Give the address of a service. The page reads what it offers." },
  {
    title: "Choose a process",
    text: "Each process is one calculation the service can run for you.",
  },
  {
    title: "Fill in the inputs",
    text: "A form is made from the process description. Areas can be drawn on the map.",
  },
  {
    title: "Run and see the result",
    text: "Quick runs answer at once; long ones carry on in the background. Results appear on the map, on the page, or as a download.",
  },
];

export function EndpointScreen(props: EndpointScreenProps) {
  const { configured, configuredError, presets, connecting, error, staticOnly, onConnect } = props;
  const base = useId();
  // Undefined until the user picks: the first service offered is then picked
  // for them, so a listed service is one click away.
  const [choice, setChoice] = useState<string | undefined>();
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | undefined>();
  const keys = [...configured.map((entry) => entry.key), ...presets.map((_, i) => presetKey(i))];
  const hasChoices = keys.length > 0;
  const selected =
    choice === undefined ? (keys[0] ?? TYPED) : keys.includes(choice) ? choice : TYPED;

  // What Connect will open, said next to the button when there is a choice.
  const selectedEntry = configured.find((entry) => entry.key === selected);
  const selectedPreset = presets.find((_, index) => presetKey(index) === selected);
  const target =
    selectedEntry?.key ??
    selectedPreset?.title ??
    (address.trim() === "" ? "the address you type" : address.trim());

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setAddressError(undefined);
    if (selectedEntry !== undefined) {
      onConnect({ source: "configured", ...selectedEntry });
      return;
    }
    const typed = typedEndpoint(selectedPreset?.url ?? address);
    if (typed === undefined) {
      setAddressError("Enter the full address of a service, starting with http:// or https://.");
      return;
    }
    onConnect(typed);
  };

  const connectButton = (
    <button type="submit" disabled={connecting !== undefined}>
      Connect
    </button>
  );

  const addressInput = (
    <input
      id={`${base}-address`}
      type="url"
      inputMode="url"
      autoComplete="url"
      spellCheck={false}
      placeholder="https://example.org/ogcapi"
      value={address}
      aria-describedby={`${base}-address-help${addressError === undefined ? "" : ` ${base}-address-error`}`}
      aria-invalid={addressError !== undefined}
      onChange={(event) => {
        setAddress(event.target.value);
        setChoice(TYPED);
      }}
    />
  );

  return (
    <section className="start" aria-labelledby={`${base}-heading`}>
      <div className="start-card card" data-main-card="true">
        <p className="eyebrow label">OGC API - Processes</p>
        <h2 id={`${base}-heading`} tabIndex={-1} data-focus-on-stage>
          Connect to a service
        </h2>
        <p className="lead">
          Try the calculations an OGC API - Processes service offers, without writing code: pick
          one, fill in a form, and see the result on the map.
        </p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field address-field">
            <label htmlFor={`${base}-address`}>Service address</label>
            {/* The button belongs to the field, like a search box's. */}
            <div className="input-with-button">
              {addressInput}
              {connectButton}
            </div>
            <p id={`${base}-address-help`} className="help">
              Its landing page, often ending in <code>/ogcapi</code>. Always reached directly.
            </p>
            {addressError !== undefined && (
              <p id={`${base}-address-error`} className="field-error">
                {addressError}
              </p>
            )}
          </div>

          {hasChoices && (
            <fieldset className="service-choices">
              <legend>Known services</legend>
              {/* Which one Connect opens, said where the choice is made. */}
              <p className="muted connect-line">
                Connect opens <strong className="connect-target">{target}</strong>
              </p>
              {configured.map((entry) => (
                <label key={entry.key} className="choice choice-card">
                  <input
                    type="radio"
                    name={`${base}-service`}
                    value={entry.key}
                    checked={selected === entry.key}
                    onChange={() => {
                      setChoice(entry.key);
                    }}
                  />{" "}
                  <span className="choice-body">
                    <strong className="choice-title">{entry.key}</strong>{" "}
                    <span className="choice-url">{entry.baseUrl}</span>
                    <span className="choice-access" data-route={entry.executeRoute}>
                      {entry.executeRoute === "relay" ? "relay" : "direct"}
                    </span>
                    {entry.executeRoute === "relay" && (
                      <span className="choice-note"> Background runs go through the relay.</span>
                    )}
                  </span>
                </label>
              ))}
              {presets.map((preset, index) => (
                <label key={presetKey(index)} className="choice choice-card">
                  <input
                    type="radio"
                    name={`${base}-service`}
                    value={presetKey(index)}
                    checked={selected === presetKey(index)}
                    onChange={() => {
                      setChoice(presetKey(index));
                    }}
                  />{" "}
                  <span className="choice-body">
                    <strong className="choice-title">{preset.title}</strong>{" "}
                    <span className="choice-url">{preset.url}</span>
                    <span className="choice-access" data-route="direct">
                      direct
                    </span>
                  </span>
                </label>
              ))}
              <label className="choice choice-card">
                <input
                  type="radio"
                  name={`${base}-service`}
                  value={TYPED}
                  checked={selected === TYPED}
                  onChange={() => {
                    setChoice(TYPED);
                  }}
                />{" "}
                <span className="choice-body">
                  <strong className="choice-title">Another service</strong>
                  <span className="choice-note"> Type its address above.</span>
                </span>
              </label>
            </fieldset>
          )}

          {configuredError !== undefined && <p className="notice">{configuredError}</p>}
        </form>

        {connecting !== undefined && (
          <p role="status" className="status">
            Connecting to {connecting.baseUrl}…
          </p>
        )}
        <ErrorMessage error={error} />
      </div>

      {props.examples}

      <details className="how-it-works">
        <summary>How it works</summary>
        <ol className="steps">
          {STEPS.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span className="help">{step.text}</span>
            </li>
          ))}
        </ol>
      </details>

      {staticOnly && (
        <details className="about-access" data-testid="static-only">
          <summary>Which services work from this page?</summary>
          <p>
            This page runs without the relay: every request goes straight from your browser to the
            service. That works when the service allows web pages to read it, by sending CORS
            headers. A background run is found only where the service also lets a page read the
            job&apos;s address (the <code>Location</code> header).
          </p>
          <p>
            Callbacks, and services that send no CORS headers, need the relay, which this site does
            not run. If a service cannot be read, the page says so after you press Connect.
          </p>
        </details>
      )}
    </section>
  );
}

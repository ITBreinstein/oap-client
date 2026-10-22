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
 * Connect then says which one it will open. The examples follow the card (in
 * the updated Instrument, they come between the address and the list), and
 * how it works and which services work are disclosures after them, so a first
 * screen shows the card and the examples.
 */

import { useId, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import type { Preset } from "../config/runtime-config.js";
import type { RelayEndpoint } from "../relay/contract.js";
import type { Place } from "./address.js";
import { sameService } from "./address.js";
import { Wordmark } from "./BrandMark.js";
import { useUpdated } from "./variant.js";
import { typedEndpoint } from "./run.js";
import type { EndpointRef, WorkflowError } from "./workflow.js";
import { ErrorMessage } from "./ErrorMessage.js";
import { endpointName, presetsMerged } from "./service-list.js";

const TYPED = "typed";
const presetKey = (index: number): string => `preset:${String(index)}`;

export interface EndpointScreenProps {
  readonly configured: readonly RelayEndpoint[];
  /** Listed earlier this visit, but the relay does not answer now (#6): shown, not offered. */
  readonly unavailable?: readonly RelayEndpoint[] | undefined;
  readonly configuredError: string | undefined;
  readonly presets: readonly Preset[];
  readonly connecting: EndpointRef | undefined;
  readonly error: WorkflowError | undefined;
  /** True when the site runs without the relay: the screen then says what that rules out. */
  readonly staticOnly: boolean;
  readonly onConnect: (endpoint: EndpointRef) => void;
  /** The featured examples, shown under the connect card. */
  readonly examples?: ReactNode;
  /** A place the page was opened with a link to: filled in, waiting for Connect. */
  readonly linked?: Place | undefined;
  /** The endpoint `error` is about. */
  readonly failed?: EndpointRef | undefined;
  /** A service's title, when this visit has read its landing page (#3). */
  readonly titleOf?: ((baseUrl: string) => string | undefined) | undefined;
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
  const { configured, configuredError, presets, connecting, error, staticOnly, onConnect, linked } =
    props;
  const base = useId();
  // Undefined until the user picks: the first service offered is then picked
  // for them, so a listed service is one click away.
  const [choice, setChoice] = useState<string | undefined>();
  const [address, setAddress] = useState(linked?.service ?? "");
  const [addressError, setAddressError] = useState<string | undefined>();
  // The last connection error put aside (#1): by typing another address,
  // choosing another service, or pressing Connect again. A new error is a
  // new object, and shows.
  const [dismissed, setDismissed] = useState<WorkflowError | undefined>();
  const shownError = error === dismissed ? undefined : error;
  // A configured endpoint of the address that failed, which the relay may
  // read once the user has agreed (#4). Not the endpoint that failed itself:
  // its own question was already asked.
  const failed = props.failed;
  const relayRead =
    shownError?.corsOrUnreachable === true && failed !== undefined
      ? configured.find(
          (entry) =>
            entry.readRoute === "relay" &&
            sameService(entry.baseUrl, failed.baseUrl) &&
            !(failed.source === "configured" && failed.key === entry.key),
        )
      : undefined;
  // STYLE TRIAL: the updated Instrument fills in the address of a service picked from the list.
  const updated = useUpdated();
  // STYLE TRIAL (#3): in the updated Instrument a preset and a relay endpoint
  // of the same address are one row, the relay's; each endpoint is named in
  // words (`service-list.ts`).
  const merged = updated ? presetsMerged(presets, configured) : new Map<number, string>();
  const listedPresets = presets
    .map((preset, index) => ({ preset, index }))
    .filter(({ index }) => !merged.has(index));
  const nameOf = (entry: RelayEndpoint): string => {
    if (!updated) return entry.key;
    const preset = [...merged].find(([, key]) => key === entry.key)?.[0];
    return endpointName(
      entry,
      props.titleOf?.(entry.baseUrl),
      preset === undefined ? undefined : presets[preset]?.title,
    );
  };
  const keys = [
    ...configured.map((entry) => entry.key),
    ...listedPresets.map(({ index }) => presetKey(index)),
  ];
  // STYLE TRIAL (#3, #6): in the updated Instrument a service is listed once;
  // a preset of the same address, reached directly, stands for it meanwhile.
  const unavailable = (props.unavailable ?? []).filter(
    (entry) => !updated || !presets.some((preset) => sameService(preset.url, entry.baseUrl)),
  );
  const hasChoices = keys.length > 0 || unavailable.length > 0;
  // A linked service is picked for the user: its entry when it is a listed
  // one, else the address it fills in.
  const linkedService = linked?.service;
  const linkedIndex =
    linkedService === undefined
      ? -1
      : presets.findIndex((preset) => sameService(preset.url, linkedService));
  const linkedKey =
    linkedService === undefined
      ? undefined
      : (configured.find((entry) => sameService(entry.baseUrl, linkedService))?.key ??
        (linkedIndex < 0 ? TYPED : presetKey(linkedIndex)));
  // STYLE TRIAL: the updated Instrument picks nothing for the user: Connect
  // goes where they chose, or to the address they typed.
  const unpicked = updated ? (hasChoices ? undefined : TYPED) : (keys[0] ?? TYPED);
  const selected: string | undefined =
    choice === undefined ? (linkedKey ?? unpicked) : keys.includes(choice) ? choice : TYPED;

  // What Connect will open, said next to the button when there is a choice.
  const selectedEntry = configured.find((entry) => entry.key === selected);
  const selectedPreset = presets.find((_, index) => presetKey(index) === selected);
  const target =
    (selectedEntry === undefined ? undefined : nameOf(selectedEntry)) ??
    selectedPreset?.title ??
    // Only an address that is one: a half-typed word is not where Connect goes.
    (typedEndpoint(address) === undefined ? "the address you type" : address.trim());

  const addressField = useRef<HTMLInputElement>(null);
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setAddressError(undefined);
    setDismissed(error);
    if (selectedEntry !== undefined) {
      onConnect({ source: "configured", ...selectedEntry });
      return;
    }
    const typed = typedEndpoint(selectedPreset?.url ?? address);
    if (typed === undefined) {
      setAddressError(
        selected === undefined && address.trim() === ""
          ? "Choose a service from the list, or enter the full address of one, starting with http:// or https://."
          : "Enter the full address of a service, starting with http:// or https://.",
      );
      // Back to the field, so the error is read with it and can be put right there.
      addressField.current?.focus();
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
      ref={addressField}
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
        setDismissed(error);
      }}
    />
  );

  return (
    <section className="start" aria-labelledby={`${base}-heading`}>
      <div className="start-card card">
        {/* STYLE TRIAL (instrument): the wordmark on a narrow screen, where the rail has none. */}
        <Wordmark className="start-wordmark" />
        <p className="eyebrow label">OGC API - Processes</p>
        <h2 id={`${base}-heading`} tabIndex={-1} data-focus-on-stage>
          Connect to a service
        </h2>
        <p className="lead">
          Try the calculations an OGC API - Processes service offers, without writing code: pick
          one, fill in a form, and see the result on the map.
        </p>
        {linkedService !== undefined && (
          <p className="notice link-notice" data-testid="link-notice">
            This link opens <strong>{linkedService}</strong>
            {linked?.process !== undefined && (
              <>
                , process <code>{linked.process}</code>
              </>
            )}
            {linked?.job !== undefined && (
              <>
                , and its job <code>{linked.job}</code>
              </>
            )}
            . Nothing is sent to it until you press Connect.
          </p>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="field address-field">
            <label htmlFor={`${base}-address`}>Service address</label>
            {/* The button belongs to the field, like a search box's. */}
            <div className="input-with-button">
              {addressInput}
              {connectButton}
            </div>
            <p id={`${base}-address-help`} className="help">
              Its landing page, often ending in <code>/ogcapi</code>.
              {/* STYLE TRIAL (#3): the updated Instrument says so of a typed address only. */}
              {(!updated || (selected === TYPED && address.trim() !== "")) &&
                " Always reached directly."}
            </p>
            {addressError !== undefined && (
              <p id={`${base}-address-error`} className="field-error" role="alert">
                {addressError}
              </p>
            )}
            {/* Under the field it is about, not under the list (#1). */}
            {connecting !== undefined && (
              <p role="status" className="status">
                Connecting to {connecting.baseUrl}…
              </p>
            )}
            <ErrorMessage error={shownError} />
            {/* The relay may read this address, as a configured endpoint: the
                way there is its question, asked after a click (#4; ADR 0001). */}
            {shownError !== undefined && relayRead !== undefined && (
              <p className="actions relay-try">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDismissed(error);
                    onConnect({ source: "configured", ...relayRead });
                  }}
                >
                  Try through the relay
                </button>
              </p>
            )}
          </div>

          {/* STYLE TRIAL: the updated Instrument offers the examples first,
              right under the address row, on a phone too (#2). */}
          {updated && props.examples}

          {hasChoices && (
            <fieldset className="service-choices">
              <legend>Known services</legend>
              {/* Which one Connect opens, said where the choice is made: once there is one. */}
              {(selected !== undefined || address.trim() !== "") && (
                <p className="muted connect-line">
                  Connect opens <strong className="connect-target">{target}</strong>
                </p>
              )}
              {configured.map((entry) => (
                <label key={entry.key} className="choice choice-card">
                  <input
                    type="radio"
                    name={`${base}-service`}
                    value={entry.key}
                    checked={selected === entry.key}
                    onChange={() => {
                      setChoice(entry.key);
                      setDismissed(error);
                      if (updated) setAddress(entry.baseUrl);
                    }}
                  />{" "}
                  <span className="choice-body">
                    <strong className="choice-title">{nameOf(entry)}</strong>{" "}
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
              {/* The relay's, while it does not answer (#6): there, but not to be chosen. */}
              {unavailable.map((entry) => (
                <label key={entry.key} className="choice choice-card" data-unavailable>
                  <input
                    type="radio"
                    name={`${base}-service`}
                    value={entry.key}
                    checked={false}
                    disabled
                    aria-describedby={`${base}-unavailable-${entry.key}`}
                  />{" "}
                  <span className="choice-body">
                    <strong className="choice-title">{nameOf(entry)}</strong>{" "}
                    <span className="choice-url">{entry.baseUrl}</span>
                    <span className="choice-unavailable" id={`${base}-unavailable-${entry.key}`}>
                      Temporarily unavailable
                    </span>
                  </span>
                </label>
              ))}
              {listedPresets.map(({ preset, index }) => (
                <label key={presetKey(index)} className="choice choice-card">
                  <input
                    type="radio"
                    name={`${base}-service`}
                    value={presetKey(index)}
                    checked={selected === presetKey(index)}
                    onChange={() => {
                      setChoice(presetKey(index));
                      setDismissed(error);
                      if (updated) setAddress(preset.url);
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
                    setDismissed(error);
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
      </div>

      {!updated && props.examples}

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

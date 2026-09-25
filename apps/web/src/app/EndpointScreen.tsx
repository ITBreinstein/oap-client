/**
 * Choose a service (S2, T8): a configured endpoint from the relay, or any
 * address typed in. One form, one Connect button.
 */

import { useId, useState, type SyntheticEvent } from "react";
import type { RelayEndpoint } from "../relay/contract.js";
import { typedEndpoint } from "./run.js";
import type { EndpointRef, WorkflowError } from "./workflow.js";
import { ErrorMessage } from "./ErrorMessage.js";

const TYPED = "typed";

export interface EndpointScreenProps {
  readonly configured: readonly RelayEndpoint[];
  readonly configuredError: string | undefined;
  readonly connecting: EndpointRef | undefined;
  readonly error: WorkflowError | undefined;
  readonly onConnect: (endpoint: EndpointRef) => void;
}

export function EndpointScreen(props: EndpointScreenProps) {
  const { configured, configuredError, connecting, error, onConnect } = props;
  const base = useId();
  const [choice, setChoice] = useState<string>(TYPED);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | undefined>();
  const selected = configured.some((entry) => entry.key === choice) ? choice : TYPED;

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    setAddressError(undefined);
    const entry = configured.find((candidate) => candidate.key === selected);
    if (entry !== undefined) {
      onConnect({ source: "configured", ...entry });
      return;
    }
    const typed = typedEndpoint(address);
    if (typed === undefined) {
      setAddressError("Enter the full address of a service, starting with http:// or https://.");
      return;
    }
    onConnect(typed);
  };

  return (
    <section aria-labelledby={`${base}-heading`}>
      <h2 id={`${base}-heading`} tabIndex={-1} data-focus-on-stage>
        Choose a service
      </h2>
      <form onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Service</legend>
          {configured.map((entry) => (
            <label key={entry.key} className="choice">
              <input
                type="radio"
                name={`${base}-service`}
                value={entry.key}
                checked={selected === entry.key}
                onChange={() => {
                  setChoice(entry.key);
                }}
              />{" "}
              <span>
                <strong>{entry.key}</strong> <span className="muted">{entry.baseUrl}</span>
                {entry.executeRoute === "relay" && (
                  <span className="muted"> — background runs go through the relay</span>
                )}
              </span>
            </label>
          ))}
          {configured.length > 0 && (
            <label className="choice">
              <input
                type="radio"
                name={`${base}-service`}
                value={TYPED}
                checked={selected === TYPED}
                onChange={() => {
                  setChoice(TYPED);
                }}
              />{" "}
              Another service
            </label>
          )}
          <p>
            <label htmlFor={`${base}-address`}>Service address</label>
            <input
              id={`${base}-address`}
              type="url"
              inputMode="url"
              placeholder="https://example.org/ogcapi"
              value={address}
              aria-describedby={`${base}-address-help${addressError === undefined ? "" : ` ${base}-address-error`}`}
              onChange={(event) => {
                setAddress(event.target.value);
                setChoice(TYPED);
              }}
            />
          </p>
          <p id={`${base}-address-help`} className="help">
            The landing page of an OGC API - Processes service. A typed address is always reached
            directly from this page, never through the relay.
          </p>
          {addressError !== undefined && (
            <p id={`${base}-address-error`} className="field-error">
              {addressError}
            </p>
          )}
        </fieldset>
        {configuredError !== undefined && <p className="notice">{configuredError}</p>}
        <p className="actions">
          <button type="submit" disabled={connecting !== undefined}>
            Connect
          </button>
        </p>
      </form>
      {connecting !== undefined && (
        <p role="status" className="status">
          Connecting to {connecting.baseUrl}…
        </p>
      )}
      <ErrorMessage error={error} />
    </section>
  );
}

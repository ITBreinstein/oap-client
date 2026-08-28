import type { ReactElement } from "react";

/**
 * The parts of an OGC API - Processes input description this form reads.
 * Everything is optional: servers leave out what they like, and the form has to
 * stay useful when they do.
 */
export interface InputSchema {
  readonly type?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: unknown;
  readonly enum?: readonly unknown[];
}

export interface InputDescription {
  readonly title?: string;
  readonly description?: string;
  readonly minOccurs?: number;
  readonly schema?: InputSchema;
}

interface ProcessInputsProps {
  readonly inputs: Readonly<Record<string, InputDescription>>;
  readonly values: Readonly<Record<string, unknown>>;
  readonly onChange: (id: string, value: unknown) => void;
}

/** `minOccurs` defaults to 1, so an absent one means required. */
function isRequired(input: InputDescription): boolean {
  return (input.minOccurs ?? 1) > 0;
}

/**
 * Values and schema defaults arrive as `unknown`, and a server is free to put an
 * object in either. Only scalars have a sensible text form; anything else is
 * shown as JSON rather than as `[object Object]`.
 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value.toString();
  // Safe without a fallback: these values came from a parsed JSON response, so
  // they can never be the function or symbol that makes `stringify` undefined.
  return JSON.stringify(value);
}

function Field({
  id,
  input,
  value,
  onChange,
}: {
  id: string;
  input: InputDescription;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  const schema = input.schema ?? {};
  const current = value ?? schema.default ?? "";

  if (schema.enum) {
    return (
      <select
        id={id}
        value={asText(current)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {schema.enum.map((option) => (
          <option key={asText(option)} value={asText(option)}>
            {asText(option)}
          </option>
        ))}
      </select>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <input
        id={id}
        type="number"
        value={asText(current)}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        onChange={(event) => {
          // An empty box is absent, not zero — the server must not be sent 0.
          onChange(event.target.value === "" ? undefined : event.target.valueAsNumber);
        }}
      />
    );
  }

  if (schema.type === "boolean") {
    return (
      <input
        id={id}
        type="checkbox"
        checked={current === true}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    );
  }

  if (schema.type === "string") {
    return (
      <input
        id={id}
        type="text"
        value={asText(current)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    );
  }

  // Anything else — objects, arrays, a missing type — is still enterable as raw
  // JSON rather than not enterable at all. Which inputs land here is worth
  // recording: it is what this client cannot yet generate a control for.
  return (
    <textarea
      id={id}
      value={typeof current === "string" ? current : JSON.stringify(current, null, 2)}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

export function ProcessInputs({ inputs, values, onChange }: ProcessInputsProps): ReactElement {
  return (
    <div>
      {Object.entries(inputs).map(([id, input]) => (
        <p key={id}>
          <label htmlFor={id}>
            {input.title ?? id}
            {isRequired(input) ? " *" : ""}
          </label>
          {input.description ? <span>{input.description}</span> : null}
          <Field
            id={id}
            input={input}
            value={values[id]}
            onChange={(value) => {
              onChange(id, value);
            }}
          />
        </p>
      ))}
    </div>
  );
}

import { type ReactElement, useState } from "react";
import { PolygonDrawMap } from "../map/PolygonDrawMap.js";

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
 * The values a freshly loaded form starts out holding.
 *
 * A control shows its schema's `default`, so the form has to hold it too. If it
 * did not, the box would read 300 while the request left the input out
 * entirely — the server would then apply its own default, which is not
 * necessarily the one on screen.
 */
export function defaultValues(
  inputs: Readonly<Record<string, InputDescription>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [id, input] of Object.entries(inputs)) {
    if (input.schema?.default !== undefined) values[id] = input.schema.default;
  }
  return values;
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

/**
 * Parses a number the user is part-way through typing.
 *
 * `undefined` for anything not yet a complete number — a lone `-`, an empty
 * box, `1e` — so a half-typed value counts as absent rather than as something
 * wrong being held.
 */
function toNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A number, entered as text.
 *
 * Deliberately not `type="number"`. A browser reports a half-typed value like
 * `-` as an empty string, and a controlled input writes that empty string
 * straight back — erasing the character as it is typed, which makes a negative
 * number impossible to enter. Holding the text exactly as typed and converting
 * only once it parses is what makes it work. The cost is the spinner arrows and
 * browser-enforced `min`/`max`, neither of which validated anything yet.
 */
function NumberField({
  id,
  integer,
  value,
  onChange,
}: {
  id: string;
  integer: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  const [text, setText] = useState(() => asText(value));
  const [lastValue, setLastValue] = useState(value);

  // Re-sync when the value changes from outside — a newly loaded process, or
  // seeded defaults. The second check matters: the parent echoes back what this
  // field just emitted, and treating that echo as an outside change would wipe
  // the text mid-edit. `-` parses to `undefined`, so without it the character
  // would be erased the instant it was typed.
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== toNumber(text)) setText(asText(value));
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(toNumber(event.target.value));
      }}
    />
  );
}

/** Text for the raw editor: a string as typed, anything else pretty-printed. */
function jsonText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/**
 * The parsed value when the text is valid JSON, and the raw text when it is
 * not — so a half-typed object is preserved rather than discarded, while
 * anything complete is held as the structure the server will be sent.
 */
function toJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The fallback control: a raw JSON editor, with drawing offered alongside.
 *
 * Drawing is opt-in rather than automatic on purpose. Nothing in a schema like
 * `{ "oneOf": [...] }` says "this is a polygon" — the only clue is often the
 * English title, and keying off prose would break on the first server that
 * writes it in Dutch. The user knows it is geometry when the schema does not
 * say, so the interface lets them say so.
 */
function JsonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactElement {
  // The text is owned here, not derived from `value`: re-deriving it on every
  // keystroke would reformat the document while it is being typed.
  const [text, setText] = useState(() => jsonText(value));
  const [drawing, setDrawing] = useState(false);

  const write = (next: string): void => {
    setText(next);
    onChange(toJson(next));
  };

  return (
    <>
      <textarea
        id={id}
        rows={8}
        cols={60}
        value={text}
        onChange={(event) => {
          write(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setDrawing((previous) => !previous);
        }}
      >
        {drawing ? "Hide map" : "Draw on a map"}
      </button>
      {drawing && (
        <PolygonDrawMap
          onChange={(features) => {
            write(JSON.stringify(features, null, 2));
          }}
        />
      )}
    </>
  );
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
  // Deliberately no fall back to `schema.default`: the container seeds those
  // with `defaultValues` when a process loads, and falling back here as well
  // would refill a box the moment the user emptied it, making an optional
  // input impossible to leave out.
  const current = value ?? "";

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
      // `value`, not `current`: the field compares what it is given against
      // what it last emitted, and `current` has already turned an absent value
      // into "" — which would read as an outside change and wipe the text.
      <NumberField id={id} integer={schema.type === "integer"} value={value} onChange={onChange} />
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
  return <JsonField id={id} value={value} onChange={onChange} />;
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

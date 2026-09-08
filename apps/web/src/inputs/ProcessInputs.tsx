import type { InputDescription, JsonSchema } from "@breinstein/oap-client";
import { type ReactElement, useState } from "react";
import { GeometryMap } from "../map/GeometryMap.js";

interface ProcessInputsProps {
  /**
   * An array, not an object keyed by id, because that is what the core hands
   * over — and because JavaScript orders integer-like keys first, so an input
   * called `1` would jump above the rest of a server's declared order.
   */
  readonly inputs: readonly InputDescription[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly onChange: (id: string, value: unknown) => void;
}

/**
 * The values a freshly loaded form starts out holding.
 *
 * A control shows its schema's `default`, so the form has to hold it too. If it
 * did not, the box would read 300 while the request left the input out
 * entirely — the server would then apply its own default, which is not
 * necessarily the one on screen.
 */
export function defaultValues(inputs: readonly InputDescription[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const input of inputs) {
    const fallback = input.schema["default"];
    if (fallback !== undefined) values[input.id] = fallback;
  }
  return values;
}

/**
 * A schema arrives with every member typed `unknown` — the core passes it
 * through exactly as the server wrote it and vouches for nothing inside. So
 * each key this form reads is narrowed here, once, and a member of the wrong
 * type is treated as absent rather than trusted into a control.
 */
function schemaType(schema: JsonSchema): string | undefined {
  const type = schema["type"];
  return typeof type === "string" ? type : undefined;
}

/** The options of an enum, when there is a non-empty list of them. */
function schemaEnum(schema: JsonSchema): readonly unknown[] | undefined {
  const options = schema["enum"];
  return Array.isArray(options) && options.length > 0 ? options : undefined;
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
        {drawing ? "Hide map" : "Draw or upload geometry"}
      </button>
      {drawing && (
        <GeometryMap
          // Every tool, for now: nothing in a `oneOf` says which geometry an
          // input wants, so offering all of them beats guessing. Form
          // generation will narrow this per input once it can read that.
          tools={["Polygon", "BoundingBox", "LineString", "Point"]}
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
  const schema = input.schema;
  const options = schemaEnum(schema);
  const type = schemaType(schema);
  // Deliberately no fall back to the schema's `default`: the container seeds
  // those with `defaultValues` when a process loads, and falling back here as
  // well would refill a box the moment the user emptied it, making an optional
  // input impossible to leave out.
  const current = value ?? "";

  if (options) {
    return (
      <select
        id={id}
        value={asText(current)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={asText(option)} value={asText(option)}>
            {asText(option)}
          </option>
        ))}
      </select>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      // `value`, not `current`: the field compares what it is given against
      // what it last emitted, and `current` has already turned an absent value
      // into "" — which would read as an outside change and wipe the text.
      <NumberField id={id} integer={type === "integer"} value={value} onChange={onChange} />
    );
  }

  if (type === "boolean") {
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

  if (type === "string") {
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
      {inputs.map((input) => (
        <p key={input.id}>
          <label htmlFor={input.id}>
            {input.title ?? input.id}
            {input.required ? " *" : ""}
          </label>
          {input.description ? <span>{input.description}</span> : null}
          <Field
            id={input.id}
            input={input}
            value={values[input.id]}
            onChange={(value) => {
              onChange(input.id, value);
            }}
          />
        </p>
      ))}
    </div>
  );
}

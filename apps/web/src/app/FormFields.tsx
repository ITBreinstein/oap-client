/**
 * The widgets, one per control kind in the plan (S3).
 *
 * Every field has a `<label>`: the input's title, falling back to its id, with
 * its description as help text linked by `aria-describedby` (T11). A group of
 * inputs — a list, a three-state boolean, a bounding box, a complex input —
 * is a `<fieldset>` with a `<legend>` instead, and each input in it still has
 * its own label.
 *
 * DOM ids come from the field's position, never from its input id: an input id
 * is server-chosen text and may contain anything.
 */

import { useId, type ReactNode } from "react";
import { isRawJson, type FormValues } from "../forms/encode.js";
import type {
  CheckboxControl,
  Control,
  FieldPlan,
  JsonControl,
  ListControl,
  NumberControl,
  SelectControl,
  TextControl,
} from "../forms/plan.js";
import { BboxField } from "./BboxField.js";
import { ComplexField } from "./ComplexField.js";
import { GeometryField } from "./GeometryField.js";

export interface ControlProps<C extends Control = Control> {
  readonly id: string;
  readonly control: C;
  readonly value: unknown;
  readonly required: boolean;
  readonly describedBy: string | undefined;
  readonly onChange: (value: unknown) => void;
  /** The label text, for inputs inside a group that need their own. */
  readonly label: string;
  /** The plan's input id, for a top-level field only: what the map draws for. */
  readonly inputId?: string | undefined;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function TextInput({ id, control, value, describedBy, onChange }: ControlProps<TextControl>) {
  const common = {
    id,
    value: asText(value),
    "aria-describedby": describedBy,
    onChange: (event: { target: { value: string } }) => {
      onChange(event.target.value);
    },
  };
  return control.multiline === true ? (
    <textarea {...common} rows={4} />
  ) : (
    <input {...common} type={control.format === "date" ? "date" : "text"} />
  );
}

function NumberInput({ id, control, value, describedBy, onChange }: ControlProps<NumberControl>) {
  // A text input, not type="number": a number input empties itself on a
  // partial entry like "0." and applies the browser's locale to the decimal
  // separator. The client-side check (T5) says what is wrong instead.
  return (
    <input
      id={id}
      type="text"
      inputMode={control.integer ? "numeric" : "decimal"}
      value={asText(value)}
      aria-describedby={describedBy}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

function SelectInput({
  id,
  control,
  value,
  required,
  describedBy,
  onChange,
}: ControlProps<SelectControl>) {
  const selected = control.options.findIndex(
    (option) => option.value === value || JSON.stringify(option.value) === JSON.stringify(value),
  );
  return (
    <select
      id={id}
      value={selected < 0 ? "" : String(selected)}
      aria-describedby={describedBy}
      onChange={(event) => {
        const index = Number(event.target.value);
        onChange(event.target.value === "" ? undefined : control.options[index]?.value);
      }}
    >
      <option value="">{required ? "Choose…" : "Not set"}</option>
      {control.options.map((option, index) => (
        <option key={index} value={String(index)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function BooleanInput(props: ControlProps<CheckboxControl>) {
  const { id, value, required, describedBy, onChange, label } = props;
  if (required) {
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    );
  }
  // Optional: three states, because an unticked box would send `false` over
  // the server's own default (R9).
  const choices: readonly [string, boolean | undefined][] = [
    ["Not set", undefined],
    ["Yes", true],
    ["No", false],
  ];
  return (
    <div
      className="choices"
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
    >
      {choices.map(([text, choice]) => (
        <label key={text} className="choice">
          <input
            type="radio"
            name={id}
            checked={value === choice}
            onChange={() => {
              onChange(choice);
            }}
          />{" "}
          {text}
        </label>
      ))}
    </div>
  );
}

function JsonInput({ id, value, describedBy, onChange }: ControlProps<JsonControl>) {
  const text = isRawJson(value)
    ? value.rawJson
    : value === undefined
      ? ""
      : JSON.stringify(value, null, 2);
  return (
    <textarea
      id={id}
      className="code"
      rows={5}
      spellCheck={false}
      value={text}
      aria-describedby={describedBy}
      placeholder="JSON"
      onChange={(event) => {
        onChange({ rawJson: event.target.value });
      }}
    />
  );
}

function ListInput(props: ControlProps<ListControl>) {
  const { id, control, value, onChange, label, describedBy } = props;
  const items: readonly unknown[] = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  const full = control.maxItems !== undefined && items.length >= control.maxItems;
  const replace = (index: number, next: unknown) => {
    onChange(items.map((item, at) => (at === index ? next : item)));
  };
  return (
    <div className="list" aria-describedby={describedBy}>
      <ol>
        {items.map((item, index) => (
          <li key={index}>
            <label htmlFor={`${id}-${String(index)}`} className="visually-hidden">
              {label}, value {index + 1}
            </label>
            <ControlView
              id={`${id}-${String(index)}`}
              control={control.item}
              value={item}
              required
              describedBy={undefined}
              label={`${label}, value ${String(index + 1)}`}
              onChange={(next) => {
                replace(index, next);
              }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onChange(items.filter((_, at) => at !== index));
              }}
            >
              Remove value {index + 1}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="secondary"
        disabled={full}
        onClick={() => {
          onChange([...items, undefined]);
        }}
      >
        Add a value
      </button>
      {control.maxItems !== undefined && <span className="help"> Up to {control.maxItems}.</span>}
    </div>
  );
}

export function ControlView(props: ControlProps): ReactNode {
  const { control } = props;
  switch (control.kind) {
    case "text":
      return <TextInput {...props} control={control} />;
    case "number":
      return <NumberInput {...props} control={control} />;
    case "select":
      return <SelectInput {...props} control={control} />;
    case "checkbox":
      return <BooleanInput {...props} control={control} />;
    case "list":
      return <ListInput {...props} control={control} />;
    case "bbox":
      return <BboxField {...props} control={control} />;
    case "complex":
      return <ComplexField {...props} control={control} />;
    case "geometry":
      return <GeometryField {...props} control={control} />;
    case "json":
      return <JsonInput {...props} control={control} />;
  }
}

/** Groups render as a fieldset, whose legend is the label. */
function isGroup(control: Control, required: boolean): boolean {
  return (
    control.kind === "list" ||
    control.kind === "bbox" ||
    control.kind === "complex" ||
    control.kind === "geometry" ||
    (control.kind === "checkbox" && !required)
  );
}

function hint(field: FieldPlan): string | undefined {
  const { control } = field;
  const notes: string[] = [];
  if (control.kind === "number") {
    if (control.min !== undefined) {
      notes.push(`${control.minExclusive === true ? "Above" : "At least"} ${String(control.min)}.`);
    }
    if (control.max !== undefined) {
      notes.push(`${control.maxExclusive === true ? "Below" : "At most"} ${String(control.max)}.`);
    }
  }
  if (control.kind === "text" && control.maxLength !== undefined) {
    notes.push(`At most ${String(control.maxLength)} characters.`);
  }
  if (!field.required) {
    const fallback =
      control.kind === "text" || control.kind === "number" || control.kind === "checkbox"
        ? control.default
        : control.kind === "select"
          ? control.default
          : undefined;
    if (fallback !== undefined) {
      notes.push(`If left empty, the server uses its default: ${JSON.stringify(fallback)}.`);
    }
  }
  if (control.kind === "json") notes.push(`Enter the value as JSON: ${control.reason}.`);
  return notes.length === 0 ? undefined : notes.join(" ");
}

export interface FieldViewProps {
  readonly field: FieldPlan;
  readonly index: number;
  readonly values: FormValues;
  readonly error: string | undefined;
  readonly onChange: (id: string, value: unknown) => void;
}

export function FieldView({ field, index, values, error, onChange }: FieldViewProps) {
  const base = useId();
  const id = `${base}-field-${String(index)}`;
  const help = field.description;
  const extra = hint(field);
  const describedBy =
    [help && `${id}-help`, extra && `${id}-hint`, error && `${id}-error`]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join(" ") || undefined;
  const value = Object.hasOwn(values, field.id) ? values[field.id] : undefined;
  const group = isGroup(field.control, field.required);
  const title = (
    <>
      {field.title}
      {field.required ? (
        <span className="required"> (required)</span>
      ) : (
        <span className="optional"> (optional)</span>
      )}
    </>
  );

  const control = (
    <ControlView
      id={id}
      control={field.control}
      value={value}
      required={field.required}
      describedBy={describedBy}
      label={field.title}
      inputId={field.id}
      onChange={(next) => {
        onChange(field.id, next);
      }}
    />
  );

  const notes = (
    <>
      {help !== undefined && (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
      {extra !== undefined && (
        <p id={`${id}-hint`} className="hint">
          {extra}
        </p>
      )}
    </>
  );

  return (
    <div
      className={`field${error === undefined ? "" : " has-error"}`}
      data-input-id={field.id}
      data-control={field.control.kind}
    >
      {group ? (
        <fieldset>
          <legend>{title}</legend>
          {notes}
          {control}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id}>{title}</label>
          {notes}
          {control}
        </>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

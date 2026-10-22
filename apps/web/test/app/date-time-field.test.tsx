/**
 * #12 on screen: a date-time input is a date, a time and an offset, which
 * make the RFC 3339 value; "Type it instead" gives the text box; a value set
 * from outside shows in the fields.
 */

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FieldView } from "../../src/app/FormFields.js";
import { browserTimeZone, formatOffset, offsetForLocal } from "../../src/forms/date-time.js";
import { planFor } from "../forms/helpers.js";

const PLAN = planFor({
  moment: { title: "Moment", schema: { type: "string", format: "date-time" } },
});

const seen: { value: unknown } = { value: undefined };
let setFromOutside: ((value: unknown) => void) | undefined;

function Harness() {
  const [value, setValue] = useState<unknown>(undefined);
  useEffect(() => {
    seen.value = value;
  });
  useEffect(() => {
    setFromOutside = setValue;
  }, []);
  const [field] = PLAN.fields;
  if (field === undefined) throw new Error("no field");
  return (
    <FieldView
      field={field}
      index={0}
      values={{ moment: value }}
      error={undefined}
      onChange={(_id, next) => {
        setValue(next);
      }}
    />
  );
}

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  seen.value = undefined;
});

function mount(): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(<Harness />);
  });
  return host;
}

function set(element: HTMLInputElement | HTMLSelectElement | null, text: string) {
  if (element === null) throw new Error("no control");
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

const date = (view: HTMLElement) => view.querySelector<HTMLInputElement>("input[type='date']");
const time = (view: HTMLElement) => view.querySelector<HTMLInputElement>("input[type='time']");
const offset = (view: HTMLElement) => view.querySelector<HTMLSelectElement>("select");
const press = (view: HTMLElement, name: string) => {
  act(() => {
    [...view.querySelectorAll("button")].find((b) => b.textContent === name)?.click();
  });
};

describe("a date-time input", () => {
  it("is a date, a time and an offset, each labelled", () => {
    const view = mount();
    expect(date(view)).not.toBeNull();
    expect(time(view)).not.toBeNull();
    expect(offset(view)).not.toBeNull();
    expect(
      [...view.querySelectorAll(".date-time-label")].map((label) => label.textContent),
    ).toEqual(["Date", "Time", "Offset from UTC"]);
  });

  it("has no value until both a date and a time are there", () => {
    const view = mount();
    set(date(view), "2026-07-15");
    expect(seen.value).toBeUndefined();
  });

  it("makes the RFC 3339 value, with the browser's offset at that date and time", () => {
    const view = mount();
    set(date(view), "2026-07-15");
    set(time(view), "14:30");
    const expected = formatOffset(offsetForLocal("2026-07-15", "14:30", browserTimeZone()));
    expect(seen.value).toBe(`2026-07-15T14:30:00${expected}`);
    expect(offset(view)?.value).toBe(expected);
  });

  it("keeps an offset once chosen", () => {
    const view = mount();
    set(offset(view), "+05:45");
    set(date(view), "2026-01-15");
    set(time(view), "09:00");
    expect(seen.value).toBe("2026-01-15T09:00:00+05:45");
  });

  it("can be typed instead, as it is sent", () => {
    const view = mount();
    press(view, "Type it instead");
    const box = view.querySelector<HTMLInputElement>("input[type='text']");
    set(box, "21-10-2026 14:30");
    expect(seen.value).toBe("21-10-2026 14:30");
    // Back to the fields: what can't be shown there is let go.
    press(view, "Use the date and time fields");
    expect(seen.value).toBeUndefined();
    expect(date(view)?.value).toBe("");
  });

  it("shows a value set from outside in its fields", () => {
    const view = mount();
    act(() => {
      setFromOutside?.("2026-10-21T14:30:00+02:00");
    });
    expect(date(view)?.value).toBe("2026-10-21");
    expect(time(view)?.value).toBe("14:30");
    expect(offset(view)?.value).toBe("+02:00");
  });

  it("is typed when a value set from outside can't be shown in the fields", () => {
    const view = mount();
    act(() => {
      setFromOutside?.("yesterday");
    });
    expect(view.querySelector<HTMLInputElement>("input[type='text']")?.value).toBe("yesterday");
  });
});

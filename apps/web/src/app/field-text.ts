/**
 * STYLE TRIAL (updated Instrument): one input's value as its field shows it,
 * for the Copy beside it in "Inputs you sent". Pasted back into the same
 * field, it is the same value. It is not what was sent: the encoder wraps a
 * geometry or a complex value (`{ "value": …, "mediaType": … }`), and the
 * panel's "Copy request" has that.
 *
 * Undefined where the field holds no one text to paste: a choice, yes or no,
 * a list, a bounding box's numbers, a file.
 */

import { isGeoJsonText, isRawJson } from "../forms/encode.js";
import { isJsonObject } from "../forms/json.js";
import type { Control } from "../forms/plan.js";

export function fieldText(control: Control, value: unknown): string | undefined {
  switch (control.kind) {
    case "text":
    case "number":
      // As the input shows it: typed text, or a default the plan gave as a number.
      return typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : undefined;
    case "geometry":
      return isGeoJsonText(value) ? value.geojson : undefined;
    case "json":
      return isRawJson(value) ? value.rawJson : undefined;
    case "complex": {
      if (!isJsonObject(value)) return undefined;
      const href = value["href"];
      if (typeof href === "string" && href.trim() !== "") return href.trim();
      if (typeof value["file"] === "string") return undefined;
      const text = value["value"];
      return typeof text === "string" ? text : undefined;
    }
    case "select":
    case "checkbox":
    case "list":
    case "bbox":
      return undefined;
  }
}

import { describe, expect, it } from "vitest";
import { preferenceOutcome, type ClassifiedAnswer } from "../../src/execution/preference.js";
import type { ExecutionMode } from "../../src/execution/types.js";
import type { PreferenceOutcome } from "../../src/observations.js";

/** The whole mapping, one row per case the brief names and the ones it implies. */
const TABLE: readonly (readonly [string, ExecutionMode, ClassifiedAnswer, PreferenceOutcome])[] = [
  [
    "async, 201 with Location",
    "async",
    { kind: "job", status: 201, locationPresent: true },
    "honoured",
  ],
  [
    "async, 202 with Location",
    "async",
    { kind: "job", status: 202, locationPresent: true },
    "honoured",
  ],
  [
    "async, 200 with the result",
    "async",
    { kind: "immediate", status: 200, locationPresent: false },
    "ignored",
  ],
  [
    "async, 200 with the result and a Location",
    "async",
    { kind: "immediate", status: 200, locationPresent: true },
    "ignored",
  ],
  [
    "async, 201 named from a body link only",
    "async",
    { kind: "job", status: 201, locationPresent: false },
    "ambiguous",
  ],
  [
    "async, 201 with no way to reach the job",
    "async",
    { kind: "unreachable-job", status: 201, locationPresent: false },
    "ambiguous",
  ],
  [
    "async, 200 carrying a job document",
    "async",
    { kind: "job", status: 200, locationPresent: true },
    "ambiguous",
  ],
  [
    "sync, 200 with the result",
    "sync",
    { kind: "immediate", status: 200, locationPresent: false },
    "honoured",
  ],
  [
    "sync, 200 with the result and a Location (pygeoapi)",
    "sync",
    { kind: "immediate", status: 200, locationPresent: true },
    "ambiguous",
  ],
  [
    "sync, 201 with Location",
    "sync",
    { kind: "job", status: 201, locationPresent: true },
    "ambiguous",
  ],
  [
    "sync, 201 with no way to reach the job",
    "sync",
    { kind: "unreachable-job", status: 201, locationPresent: false },
    "ambiguous",
  ],
];

describe("preferenceOutcome", () => {
  it.each(TABLE)("%s → %s", (_, mode, answer, expected) => {
    expect(preferenceOutcome(mode, answer)).toBe(expected);
  });
});

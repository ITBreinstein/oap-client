# Review: the forms prototype

**Reviewed:** `feat/T3-prototype-interface` at `b737adf` (Sam, 27 August 2026) —
`packages/core/src/forms/` and its three test files.
**Reviewed on:** 23 September 2026, before porting it into `apps/web/src/forms/`.
**Outcome:** the design carries over unchanged. Of eighteen items — the twelve
suspicions the review started from and six it found — sixteen are confirmed and
fixed in the port, one is confirmed and kept as a known limitation (N4), and
one is refuted (R9), as is part of a second (R5).

## What the prototype got right

These parts carry into the port as they are, and they are why a port was
possible rather than a rewrite.

- **The plan is plain data.** A union of control kinds plus diagnostics, with
  no rendering in it. That is what lets the form layer sit behind a
  dependency rule (`form-plan-is-framework-free`) and be promoted to the core
  later as a move rather than a rewrite. Every fix below is a new field or a new
  arm of that union; none needed a different shape.
- **An ordered matcher chain with a guaranteed fallback.** Every fix below is a
  new matcher or a change inside one; none needed a special case outside the
  chain. The fallback always produces a control, so a form is always
  generated.
- **It never throws on a hostile document.** Of nineteen deliberately hostile
  schemas — a number as the `type`, a junk `type` array, a self-referencing
  `items` chain, non-object schemas, a `oneOf` that is not an array, a `$ref`
  that is not a string and so on — exactly one made it throw (N6, a cyclic
  object inside an `enum`, which cannot arrive over the wire). It resolved all
  701 readable ZOO-Project descriptions without an exception.
- **Every fallback is a diagnostic, and a diagnostic is an observation.** The
  failure catalogue this project owes can be assembled from these without
  reading any code. The port adds one field, the schema keyword that caused
  the fallback, and otherwise keeps them as they were.
- **No type assertions, strict lint clean, 60 tests passing.** The port keeps
  that: it has no `as` in its source either.

Where the prototype went wrong, it was almost always for one of two reasons.
It was written before the Task 3 census (31 August), so it could not know that
a quarter of ZOO's inputs are `oneOf`s with their media types _inside_ the
branches, or that 457 inputs contradict themselves. And it was checked against
its own intent rather than against the standard's own examples, which use two
shapes it refuses.

## Method

Every suspicion was treated as a claim to be proved. For each one a test was
written asserting the correct behaviour, and run against the prototype
**unmodified**, in a scratch worktree. A test that failed confirmed the
suspicion; a suspicion no failing test could be written for is recorded as
refuted. Nothing on the branch was changed.

Three sources were checked:

- **The standard.** OGC API - Processes 1.0 Part 1: the published schemas
  (`bbox.yaml`, `execute.yaml`, `inlineOrRefData.yaml`,
  `inputValueNoObject.yaml`, `qualifiedInputValue.yaml`, `format.yaml`) and the
  published examples `ProcessDescription.json` and `Execute.json`, from
  `schemas.opengis.net/ogcapi/processes/part1/1.0/`.
- **The servers.** All 701 readable ZOO-Project descriptions (5 098 inputs),
  fetched live on 23 September, and the pinned pygeoapi 0.21.0 with the
  repository's own processes — including three added for this review's
  sake: `breinstein-bbox`, `breinstein-inputs` and `breinstein-png`.
- **The findings** recorded so far, especially 0025 (ZOO refuses an execute
  body with no `outputs`).

### Reproducing the failures

The probes are one file, committed as a patch next to this review:

```bash
git worktree add --detach /tmp/proto b737adf
cd /tmp/proto && pnpm install
git apply <this repo>/docs/reviews/forms-prototype-probe.patch
pnpm vitest run packages/core/test/forms/review-probe.test.ts
# 21 tests, 21 failed
```

Each probe is carried into the port as a regression test under the same id, in
`apps/web/test/forms/`, where it passes.

## Verdicts

| #   | Suspicion                                            | Verdict                 | Regression test                                                         |
| --- | ---------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| R1  | `type: [string, number]` becomes a number field      | confirmed, fixed        | `matchers.test.ts` › R1 (two rows)                                      |
| R2  | `exclusiveMinimum`/`exclusiveMaximum` ignored        | confirmed, fixed        | `matchers.test.ts` › R2 (three rows); `validate.test.ts` › exclusive    |
| R3  | `const` becomes a free text field                    | confirmed, fixed        | `matchers.test.ts` › R3                                                 |
| R4  | bbox plan does not say 4 or 6 coordinates            | confirmed, fixed        | `matchers.test.ts` › R4                                                 |
| R5  | CRS options read too narrowly                        | partly confirmed, fixed | `matchers.test.ts` › R5 (two rows)                                      |
| R6  | nobody builds the bbox wire object                   | confirmed, fixed        | `encode.test.ts` › bounding boxes                                       |
| R7  | `mediaType` never found, so nothing is qualified     | confirmed, fixed        | `matchers.test.ts` › R7; `encode.test.ts` › R7                          |
| R8  | the body has no `outputs`, which ZOO refuses         | confirmed, fixed        | `workflow.test.ts` › R8                                                 |
| R9  | an optional boolean cannot say "not set"             | refuted                 | `encode.test.ts` › R9; `validate.test.ts` › R9                          |
| R10 | array input with `maxOccurs > 1` collapsed           | confirmed, fixed        | `resolve.test.ts` › R10; `encode.test.ts` › R10                         |
| R11 | loose bbox detection                                 | confirmed, fixed        | `matchers.test.ts` › R11 (two rows)                                     |
| R12 | `null` in an `enum` becomes a "null" option          | confirmed, fixed        | `matchers.test.ts` › R12                                                |
| N1  | the standard's own bbox input falls back to raw JSON | confirmed, fixed        | `matchers.test.ts` › N1                                                 |
| N2  | booleans with a string `enum` become a string select | confirmed, fixed        | `matchers.test.ts` › N2 (two rows)                                      |
| N3  | a single-format string is sent as a qualified value  | confirmed, fixed        | `encode.test.ts` › N3 (a corrected prototype row)                       |
| N4  | a geometry object is sent bare                       | **accepted limitation** | `encode.test.ts` › "sends a geometry inline, untouched — accepted … N4" |
| N5  | input ids like `__proto__` and `constructor`         | confirmed, fixed        | `encode.test.ts` › N5 (two rows); `validate.test.ts` › N5               |
| N6  | a cyclic `enum` value throws                         | confirmed, fixed        | `matchers.test.ts` › N6; `census.test.ts` › never throws                |

"Confirmed" means a probe failed against `b737adf`; the failing assertion is
quoted under each item. How often each case occurs in practice is given too,
because several are real defects that no server in the testbed triggers today.

## The items

### R1 — a multi-type schema gets a control narrower than the schema

**Confirmed.** `{ type: ["string", "number"] }` resolves to
`{ kind: "number" }`: the boolean and number matchers run before the string
matcher, and the first type that matches wins. A user could then never enter a
string the server would accept.

> `expected 'number' to be 'json'`

**Fix.** A new matcher, before the type matchers: more than one non-null type
gets the raw JSON editor, with an `unsupported-type` diagnostic naming the
`type` keyword. `["string", "null"]` is still a text field, and
`["integer", "number"]` is still one number field (a non-integer one — the
prototype would have made it an integer field).

**How often.** No `type` array in any of the 701 ZOO descriptions or the four
pygeoapi ones. A correctness fix, not one any current server needed.

### R2 — exclusive bounds

**Confirmed**, in both spellings.

- OpenAPI 3.0's boolean form, `minimum: 0, exclusiveMinimum: true`, is what the
  standard's own example process uses (`doubleInput` in
  `ProcessDescription.json`). The prototype read `min: 0` and dropped the
  flag, so the client would accept the one value the schema forbids.
- JSON Schema 2019's numeric form, `exclusiveMaximum: 1`, produced no bound at
  all.

> `expected { Object (kind, integer, ...) } to match object { kind: 'number', min: +0, …(1) }`
> `expected { Object (kind, integer, ...) } to match object { kind: 'number', max: 1, …(1) }`

**Fix.** `NumberControl` gains `minExclusive` / `maxExclusive`. A numeric
exclusive bound wins only when it is tighter than the inclusive one. The
client-side check honours it.

**How often.** No ZOO or pygeoapi input uses either form; the standard's example
does.

### R3 — `const`

**Confirmed.** `{ type: "string", const: "fixed" }` became a free text field.

> `expected { kind: 'text', …(5) } to deeply equal { kind: 'select', …(2) }`

**Fix.** `const` is an enum of one: a select with the single value, preselected.

**How often.** None in the census.

### R4 — bounding-box dimensions

**Confirmed.** `bbox.yaml` allows four **or** six numbers (`oneOf` of
`minItems`/`maxItems` 4 and 6), and its `crs` enum includes CRS84h, which is
three-dimensional. The plan recorded only the CRS list, so nothing downstream
could know whether a four-number, map-drawn box was acceptable.

> `expected { kind: 'bbox', crs: [ …(2) ] } to match object { kind: 'bbox', dimensions: [ 4, 6 ] }`

**Fix.** `BboxControl.dimensions`, read from the `bbox` member's `oneOf` or its
`minItems`/`maxItems`, and `[4, 6]` when unstated (which is what `bbox.yaml`
says). pygeoapi's `breinstein-bbox` declares exactly four; ZOO's four bbox
inputs declare four or six. The map only draws where four is allowed, and the
CRS picker for a drawn box leaves CRS84h out.

### R5 — CRS options

**Partly confirmed.** The prototype reads `crs.enum`, then `crs.default`, then
assumes CRS84. Checked against every way the testbed declares a bbox CRS:

- the standard's `bbox.yaml`: `enum` [CRS84, CRS84h] with `default` CRS84 — read
  correctly;
- all four ZOO bbox inputs (`echo`, `EchoProcess` and the two n52 copies): one
  identical declaration, `enum` of `urn:ogc:def:crs:EPSG:6.6:4326` and
  `…:6.6:3785`, `default` the first — read correctly;
- pygeoapi's `breinstein-bbox`: `enum` [CRS84], `default` CRS84 — read
  correctly.

No input anywhere declares `crs` with `anyOf`, or with `format: uri` and no
`enum`. **Refuted**: the suspicion that `anyOf` or a bare `format: uri` is
mishandled. With no `enum` the prototype falls back to the `default` or CRS84,
and CRS84 is `bbox.yaml`'s own default, so that is right.

**Confirmed**: when an `enum` is present the declared `default` is dropped, so
a form preselects whatever is listed first rather than what the server would
have chosen.

> `expected { kind: 'bbox', …(1) } to match object { kind: 'bbox', defaultCrs: 'urn:b' }`

**Fix.** `BboxControl.defaultCrs`: the declared default when it is in the
`enum`, else the first entry. The standard's by-reference form is N1.

### R6 — who builds `{ "bbox": […], "crs": "…" }`

**Confirmed, by decision.** The encoder passed a bbox value through untouched,
so whoever held the value had to know the wire shape — in practice the map
binding, which is not allowed to know the protocol.

> `expected { extent: { …(2) } } to deeply equal { extent: { bbox: [ 3, …(3) ], …(1) } }`

**Fix.** The encoder builds the wire object from the widget's coordinates and
the chosen CRS, and always sends the CRS (ZOO's bbox schema lists it as
required). Coordinates reach it longitude-first whatever the CRS, from the map
and from the typed fields alike. When the chosen CRS is EPSG:4326 in any of its
URI spellings, the encoder swaps to latitude-first and says so, so that the
swap is recorded as an observation.

> `expected { c: { …(2) } } to deeply equal { c: { …(2) } }` — the EPSG:4326 probe

That swap is not hypothetical. ZOO's only bbox inputs list EPSG:4326 and 3785,
and ZOO discards whatever `crs` it is sent and relabels the box with its own
default (finding 0051), so a CRS84 box sent unswapped arrives as a box with its
axes the wrong way round.

**Also corrected:** the prototype's own row "sends a bbox inline, untouched" used
coordinates in degrees labelled EPSG:28992, whose unit is the metre. The row
survives, with RD coordinates.

### R7 — media types live inside `oneOf` branches

**Confirmed.** `qualify()` reads `contentMediaType` only at the top level of a
schema. The census found it at the top level **nowhere** in ZOO. Every one of
its 4 214 occurrences is inside a `oneOf` branch. So the prototype never
produced a qualified value for a real ZOO input, and every such input — 1 436 of
5 098, 28% — fell back to raw JSON on the `oneOf` refusal instead.

> `expected 'json' to be 'complex'`
> `expected { InputPolygon: { format: +0, …(1) } } to deeply equal { InputPolygon: { …(3) } }`

**Fix.** A `ComplexControl` (T3): a `oneOf` whose every branch is an alternative
encoding of one value — a string with a `contentMediaType` and/or
`contentEncoding`, or a bare `type: "object"` — lets the user pick the format,
then give the value inline or as a URL. The encoder sends the chosen branch's
`mediaType` and `encoding` in a qualified value, `{ "value": … }` for the JSON
object branch, and `{ "href": …, "type": … }` for a URL. Any other `oneOf` is
still refused.

That pattern covers 1 434 of ZOO's 1 436 `oneOf`s. The remaining two are
`oneOf` of identical bare-object branches (`GdalExtractProfile.Geometry`,
`display.tmpl`), which it covers too, as one "JSON object" choice. Across all
701 descriptions the raw JSON fallback rate goes from 28.2% to 0%.

### R8 — the execute body has no `outputs`

**Confirmed.** `toExecuteRequest` builds a body of `inputs` and, optionally,
`response`. ZOO answers a body without `outputs` with
`400 InvalidParameterValue` (finding 0025).

> `expected { inputs: { a: 'x' } } to have property "outputs"`

Not moot in the port, which was the hope. The port drops `toExecuteRequest`
and its `ExecuteOptions` and takes only `inputs` from the encoder. The request
is built by the core's `execute()`. But the core deliberately never
synthesises `outputs` — that would hide 0025 — so the web app has to supply
it.

**Fix.** The run step names every declared output, with no format or
transmission mode, which is the standard's way of saying "all of them, as the
server likes". The encoder's `response` member is gone, so nothing competes
with the core's.

### R9 — an optional boolean cannot say "not set"

**Refuted** as a defect of the prototype. The plan carries `required`, and the
encoder already leaves `undefined` out of the request. A control that can
produce `undefined` is all it takes, and that is a rendering decision the plan
does not constrain. No failing test can be written against the plan or the
encoder.

**The rendering decision**, made on evidence: an optional boolean gets three
states — not set, yes, no — and starts not set. 462 of ZOO's 516 booleans are
optional, 181 of them default to `true`, and neither server validates its
inputs (Z5). A checkbox that sends `false` when left alone would silently
override those defaults.

### R10 — an array input that also repeats

**Confirmed against the standard.** `execute.yaml` defines each input value as
`oneOf: [inlineOrRefData, array of inlineOrRefData]`, and `inputValueNoObject`
includes `type: array`. So an input that is `type: "array"` with
`maxOccurs > 1` takes an array of arrays. The prototype collapsed it into one
list, and deliberately so ("no server in the testbed means that"); its test
"does not wrap an array schema twice" pinned the collapse.

> `expected { kind: 'list', item: { …(6) }, …(2) } to match object { kind: 'list', …(1) }`

**Fix.** The comment was right about the testbed: no such input exists among
the 701 + 4 descriptions. The fix is one line and the standard is unambiguous,
so it is made. `multiple` always wraps, and the prototype's row is corrected
rather than kept.

### R11 — loose bbox detection

**Confirmed, with a realistic schema.** Any object with a `properties.bbox`
object counted as a bounding box, and so did any `$ref` containing "bbox". A
GeoJSON Feature schema has a `bbox` member, so an input declared as an inline
Feature would have been offered a rectangle to draw.

> `expected 'bbox' not to be 'bbox'`

**How often.** No false positives anywhere in the census. The four inputs the
loose rule matches are the four real bbox inputs, and no `$ref` appears in any
`schema`.

**Fix.** The structural rule needs `bbox` to be array-like and to be, with an
optional `crs`, the object's _only_ properties. The `$ref` rule needs the
reference to name the schema document itself (`…/bbox.yaml`, `…/bbox.json`).

### R12 — `null` in an `enum`

**Confirmed.** `null` became an option labelled "null". The encoder drops a
`null` value, so choosing it could only ever mean "not set", and it did not
say so.

> `expected { kind: 'select', …(1) } to deeply equal { kind: 'select', …(1) }`

**Fix.** `null` is not offered. An optional select has its own "not set" choice
in the renderer. No `enum` in the census contains `null`.

### N1 — the standard's own bounding-box input falls back to raw JSON

**Confirmed.** The standard's example process declares its bbox as

```json
{ "allOf": [{ "format": "ogc-bbox" }, { "$ref": "../../openapi/schemas/bbox.yaml" }] }
```

The bbox matcher looks for `format` only at the top level, so the `allOf` is
refused as an unsupported keyword and the user gets a raw JSON editor for the
one spatial input shape the standard itself demonstrates.

> `expected { kind: 'json', …(2) } to match object { kind: 'bbox', crs: [ …(2) ], …(1) }`

**Fix.** The bbox matcher also looks inside `allOf` members. A `$ref` to the
`bbox.yaml` document is read as that document's known content: CRS84 or
CRS84h, four or six numbers.

### N2 — booleans with a string `enum`

**Confirmed, in 457 real inputs.** ZOO's SAGA wrappers declare optional
booleans as

```json
{ "type": "boolean", "default": false, "enum": ["true", "false"], "nullable": true }
```

No value satisfies both `type` and `enum`, because a boolean is not the string
`"true"`. The prototype's enum matcher runs first and produced a select of
strings. Its default, the boolean `false`, matched neither option, so nothing
was preselected, and the value sent was the string `"true"` or `"false"`.

> `expected { kind: 'select', …(2) } to deeply equal { kind: 'checkbox', default: false }`

**Fix.** When no `enum` value is of the declared type, the schema contradicts
itself; the declared type wins, and a `contradictory-schema` diagnostic records
it. Finding 0056. ZOO accepts `true`, `"true"`, `1` and `"maybe"` for these
inputs alike, so the choice is about honesty, not about what the server takes.

### N3 — a single-format string sent as a qualified value

**Confirmed, and one of the prototype's own rows pinned it.**
`{ type: "string", contentMediaType: "text/plain" }` was encoded as
`{ "value": "…", "mediaType": "text/plain" }`. A JSON string carries plain text
natively, and a server that declared one format already knows it. pygeoapi
hands the wrapper to the processor as it is. `breinstein-inputs` echoes it
back as an object where its schema promised a string
(`pygeoapi/execution/breinstein-inputs-qualified-not-unwrapped.http`, finding
0052).

> `expected { notes: { …(2) } } to deeply equal { notes: 'first\nsecond' }`

**Fix.** A value is qualified only when the user picked a format from
alternatives: the complex control (R7). The prototype's row "wraps a value
whose media type the body cannot carry natively" is corrected. The field
still carries the top-level media type, for display.

### N4 — a geometry object sent bare

**Confirmed against the standard, and accepted as a known limitation.** 1.0's
`inlineOrRefData` is `inputValueNoObject`, a qualified value or a link.
`inputValueNoObject` admits strings, numbers, booleans, arrays, binary and
bounding boxes, and **no** bare object. So an object value belongs in
`{ "value": … }`, which is exactly what the standard's own `Execute.json` does
for its GeoJSON. ZOO agrees: a bare object for a complex input gets a 500, and
`{ "value": {…} }` works
(`zoo-project/execution/echo-complex-bare-object-500.http`,
`…/echo-complex-value-object.http`). The prototype's geometry control passes a
geometry through bare.

> `expected { area: { type: 'Point', …(1) } } to deeply equal { area: { value: { …(2) } } }`

**Why it is accepted.** Drawing geometries is out of scope for Task 7. A
geometry input renders as a raw JSON editor, where the user writes the wire
value, so the encoder's pass-through is exactly right for what the UI does
today. The right wrapping, and whether pygeoapi processes can take it (N3
says pygeoapi does not unwrap), is decided when drawing lands. The test is
kept, pinned to the current behaviour, with this reasoning beside it.

The complex control's JSON object branch _is_ wrapped, because there the
encoder builds the wire value.

### N5 — input ids that collide with `Object.prototype`

**Confirmed, with two symptoms.**

- An input with the id `__proto__` could never be sent. `inputs["__proto__"] = x`
  sets the object's prototype instead of a property, so the value silently
  vanished.
  > `expected {} to deeply equal { __proto__: 'x' }`
- An input with the id `constructor` and `maxOccurs > 1` was sent **without
  the user filling it in**. `values["constructor"]` reads `Object`, a
  function, which survives the absent-check and serialises as `[null]`.
  > `expected { constructor: [ null ] } to deeply equal {}`

A hostile document is in scope ("never throws on a hostile document"), and so
is sending a value the user did not give.

**Fix.** Values are read with `Object.hasOwn`, the `inputs` object is built with
`Object.fromEntries`, and validation errors live in a `Map`.

### N6 — a cyclic value in an `enum` throws

**Confirmed.** `labelFor` calls `JSON.stringify`, which throws on a cycle. A
cycle cannot come out of `JSON.parse`, so no server can send one, but the
resolver's contract is about whatever it is handed. The prototype's own suite
builds a cyclic `items` to test exactly that contract.

> `expected [Function] to not throw an error but 'TypeError: Converting circular struct…' was thrown`

**Fix.** Labels never throw; an unprintable value gets an honest label.

## What happened to the prototype's 60 tests

All of them were reviewed; 55 survive in `apps/web/test/forms/`, adapted to the
core's parsed description. The helpers run a raw document through the core's
own `parseDescription`, so the tests see exactly what the app sees.

| Change                | Rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Corrected**         | "does not wrap an array schema twice" (R10); "wraps a value whose media type the body cannot carry natively" (N3). Both pinned behaviour the review found wrong, so their expectations were inverted rather than kept.                                                                                                                                                                                                                                                                              |
| **Extended**          | "ogc-bbox format" and "a bbox recognised by its properties" also expect `defaultCrs` and `dimensions`. "refuses %s rather than guessing" also expects the diagnostic's `keyword`.                                                                                                                                                                                                                                                                                                                   |
| **Adapted**           | "still produces a field when the input has no schema": the core degrades a missing schema to `{}` with a warning, so the resolver sees "anything" and gives it a JSON editor with an `unsupported-type` diagnostic. "sends a bbox inline, untouched": new test data (see R6). "sends a geometry inline, untouched": kept and pinned as N4.                                                                                                                                                          |
| **Moved to the core** | "still produces a field when the input description is not an object" and the second half of "accepts a process with no inputs, and reports inputs of the wrong shape". The core's parser owns malformed documents: it drops a non-object input and reports an `inputs` of the wrong shape, and the process screen shows its warnings. The rows now assert the core's answer. The `malformed-description` diagnostic code went with them.                                                            |
| **Dropped**           | "reports a description that is not an object at all": the core's `parseDescription` throws for it, so the resolver is never called, which the core's own suite covers (`packages/core/test/processes/parse-description.test.ts`). "carries the response preference" and the three `toExecuteRequest` rows: the code is gone, because the core's `execute()` builds the request and `packages/core/test/execution/build-request.test.ts` covers `Content-Type`, `Prefer` and the omitted `response`. |

## Numbers

Over all 701 readable ZOO-Project descriptions, 5 098 inputs, 23 September 2026:

|                                        | Prototype     | Port without the complex control | Port  |
| -------------------------------------- | ------------- | -------------------------------- | ----- |
| raw JSON fallback (incl. inside lists) | 1 436 (28.2%) | 1 436 (28.2%)                    | 0     |
| complex control                        | —             | —                                | 1 436 |
| checkbox                               | 59            | 516                              | 516   |
| select                                 | 1 279         | 822                              | 822   |
| `contradictory-schema` diagnostics     | —             | 457                              | 457   |

N2 moves the 457 contradictory SAGA booleans from select to checkbox. The
complex control removes every fallback. None of the other fixes changes a ZOO
number: the shapes they fix do not occur there. They occur in the standard's
own examples, in pygeoapi's new processes, or in hostile documents.

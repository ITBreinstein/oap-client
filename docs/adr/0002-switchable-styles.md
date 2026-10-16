# 2. Three switchable styles on trial, and how to remove two

- **Status:** accepted. Instrument is kept; hybrid and precise were removed
  on 2026-10-16. Instrument is now compared with an updated version of
  itself (below), until one of the two is chosen.
- **Date:** 2026-10-14
- **Where:** `apps/web` only: `src/styles/`, `src/styles.css`,
  `src/app/appearance.ts`, `src/app/useAppearance.ts`,
  `src/app/AppearanceControl.tsx`, `src/app/AppFrame.tsx`. `packages/core`
  and `apps/relay` are unchanged.

## Context

Three visual styles were designed for the web app: **soft-precise hybrid**,
**precise** (cartographic) and **instrument** (a dark tool). One will be
kept. The choice is to be made in the real app, against real services, by
switching between them on the fly, and each needs a night mode.

Two of the three will be deleted afterwards, so whatever lets them coexist
must be thin and come out cleanly: no style-specific logic spread through
the components, and behaviour the same in every style.

## Decision

### Style and theme are two things

- The **style** is shape, type and layout: radii, borders or shadows, fonts,
  how labels look, where panels dock, the instrument's rail.
- The **theme** is colour only: light or dark. A theme never changes a
  radius or a layout.

Both are attributes on `<html>`: `data-style="hybrid|instrument|precise"`
and `data-theme="light|dark"`. Stylesheets read nothing else.
`color-scheme` follows `data-theme` in CSS, so native controls (scrollbars,
date pickers, `<select>`) match without an inline style, which the static
site's content security policy (`style-src 'self'`) would refuse.

### Where the choice comes from

`src/app/appearance.ts`, pure and unit-tested: the address
(`?style=precise&theme=dark`) wins, then the choice saved in this browser
(`localStorage`, key `oap.appearance`), then the defaults: hybrid, following
the system. Anything unrecognised is ignored. Storage is read and written in
`try`/`catch`. Choosing in the Appearance control saves only the member
changed, so a style that came from a shared link never overwrites someone's
saved one.

`main.tsx` writes both attributes before the first render. An inline script
in `index.html` would do it sooner, but the policy allows none; until
`main.tsx` runs, `tokens.css` gives a dark system a dark page.
`useAppearance` keeps the attributes in step afterwards and follows the
system's setting live (`useSyncExternalStore` over `matchMedia`) while the
preference is "Follow system".

### Tokens, then structure, then one file per style

```
src/styles/fonts.ts             @fontsource imports (Latin subset, weights in use)
src/styles/tokens.css           every colour, font, radius and shadow, by meaning
src/styles.css                  structure; names tokens only, never a colour
src/styles/style-hybrid.css     what hybrid does beyond the structure
src/styles/style-precise.css    what precise does beyond the structure
src/styles/style-instrument.css what instrument does beyond the structure
```

`tokens.css` has two kinds of block, so the separation holds by
construction:

- one **shape** block per style, `[data-style="…"]`: fonts, label
  treatment, radii. Never a colour.
- two **colour** blocks per style, `[data-style="…"][data-theme="…"]`:
  colours and shadows. Never a size.

`:root` carries the hybrid blocks as well, so the page is complete before
the attributes are written. Every rule in a `style-*.css` file is scoped
under its `[data-style="…"]`. The one place colour is not a token is the
map's own (`map/basemap.ts`), and the legend swatches that mirror it: the map
looks the same on a light and a dark page.

`test/styles/tokens.test.ts` keeps this honest: every style × theme defines
every token, shape blocks hold no colour and colour blocks no shape, text
reaches 4.5:1 and field borders and focus 3:1 against what they sit on, and
no other stylesheet names a colour.

### One style-aware component

`AppFrame` is the only code that asks which style is on: a header across the
top (hybrid, precise) or a rail down the left edge (instrument). Everything
else differs in CSS. Where one style shows something the others do not, the
markup is there for all and the structure hides it, and only that style's
file shows it:

| Shown by               | What                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| precise                | the header's way back and place (`back`, `context` on `AppFrame`, hiding the breadcrumb), the list's "Connected" and glyph key, a process's needs and runs, the map's scale bar and compass, the jobs table's column heads |
| instrument             | "Prefer: respond-async" in the run bar, the needs marks                                                                                                                                                                    |
| precise and instrument | the process table's column heads, the request log                                                                                                                                                                          |

### What every style has

Examples (config.json `examples`, featured on the start screen, and "Browse
all"), My jobs, and night mode are features of the app, not of a style: they
stay whichever style is kept. The examples and jobs panels are one
component, `SidePanel`; where they dock is each style's CSS.

## Alternatives considered

- **Six self-contained blocks** (each style × theme defining everything):
  simpler to read, but every radius and font written twice, and nothing
  stopping a dark block from changing a shape. Rejected for the split above.
- **A CSS framework or CSS-in-JS for theming**: rejected by T11 (no
  framework), and either would spread style logic into the components.
- **A style switch in React** (`if (style === …)` in screens): rejected;
  the frame is the one exception, because a rail and a header are different
  markup.
- **Google Fonts**: refused by the policy (`font-src 'self'`), and a request
  to a third party on every visit.

### Instrument in Breinstein's colours (2026-10-16)

Instrument now uses Breinstein's colours: midnight navy, and violet as the one
main colour in both themes; lime is gone. Its rail carries Breinstein's
wordmark (`src/app/BrandMark.tsx`) as a link to the start screen, an About
item above Appearance opens an About panel (`src/app/AboutPanel.tsx`) like
Examples and Jobs, and the Log item is gone: the developer section is reached
from its fold at the foot of the page. The web app's version (0.5.0, from its
`package.json` at build time) shows in About beside the core's.

### Instrument kept; its update on trial (2026-10-16)

Hybrid and precise are gone: their stylesheets, colour blocks, the header
branch of `AppFrame` (with its breadcrumb, way back and mark), the elements
only they showed, and IBM Plex. `AppFrame` is now the rail alone.

A UI/UX review of instrument led to an updated version, to be compared with
instrument as it is before one is kept. The Appearance control's "Style"
group now offers "Instrument" and "Instrument (updated)" (`?style=` takes
`instrument` and `instrument-updated`). Both are `data-style="instrument"`,
so every instrument rule applies to both; the updated one is also
`data-variant="updated"`, and its changes live in
`src/styles/style-instrument-updated.css`, all under that attribute.

Fixes that change nothing on screen (what screen readers are told, where
focus goes) and plain bugs apply to both versions; only what changes how
the app looks or reads is the update's.

## Consequences

- The trial costs three stylesheets, six colour blocks and one branch in
  `AppFrame`, all named here and all removable.
- The Appearance control is shown in every style during the trial. Its
  "Night mode" group stays after it; its "Style" group goes.
- Fonts for both families ship in the build (about 185 KB of woff2; a
  browser fetches a font only when the page's text uses it).

## Removing what is left of the trial

Hybrid and precise were removed on 2026-10-16, following the steps this
section held until then (in the history of this file).

### Instrument or its update

When one of the two versions is chosen:

1. If the update is kept, move the rules of
   `src/styles/style-instrument-updated.css` into `style-instrument.css`
   without the `[data-variant="updated"]` prefix; if it is not, leave them
   out. Either way, delete the file and its import in `src/main.tsx`.
2. `src/app/appearance.ts`: drop `"instrument-updated"` from `STYLE_NAMES`
   and stop writing `data-variant`; `src/app/AppearanceControl.tsx`: drop
   the "Style" fieldset and `STYLE_LABELS`, keeping "Night mode".
3. Markup that only the update shows, hidden by default in `styles.css`: keep
   it and its rules, or delete both, as step 1 decides. Each is listed in
   the header of `style-instrument-updated.css`.
4. Tests: `test/app/appearance.test.tsx`, and the version loops in
   `e2e/instrument-backdrop.spec.ts` and `e2e/styles.capture.ts`.

### Removing the backdrop

Europe behind the start screen: delete `src/styles/backdrop.css` and its
import in `src/main.tsx`, the two pictures in `src/assets/backdrop/`, the
credit chip (`.backdrop-credit` in `App.tsx`), `scripts/fetch-backdrops.sh`,
the three entries in section 6 of `THIRD_PARTY.md`, the "Start screen
imagery" row in About and `e2e/instrument-backdrop.spec.ts`; and drop
`--backdrop-scrim` from every block in `tokens.css` and from the token test.
The theme switch's side of it goes too: `src/app/backdrop.ts` and
`test/app/backdrop.test.ts`, and in `useAppearance.ts` the `ready` it
passes to `switchTheme` and the effect that fetches the other picture. The
crossfade itself (`theme-switch.ts`) belongs to every style and stays.

### Then, optionally: flatten

With one version left, the style dimension can go: remove `StyleName` and
the style half of `appearance.ts` and the Appearance control (keep the theme
half), stop writing `data-style`, fold the shape block into `:root` and the
colour blocks into `[data-theme="light"]` and `[data-theme="dark"]`, and
move `style-instrument.css` into `styles.css` without the
`[data-style="instrument"]` prefix. The streets in `styles.css` and the
`--backdrop-*` tokens other than `--backdrop-scrim` can go then too: they
are all in the page colour.

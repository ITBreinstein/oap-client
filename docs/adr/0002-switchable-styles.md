# 2. Three switchable styles on trial, and how to remove two

- **Status:** accepted, for the trial. Once a style is chosen, this ADR's
  "Removing a style" is carried out and its status names the one kept.
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

## Consequences

- The trial costs three stylesheets, six colour blocks and one branch in
  `AppFrame`, all named here and all removable.
- The Appearance control is shown in every style during the trial. Its
  "Night mode" group stays after it; its "Style" group goes.
- Fonts for both families ship in the build (about 185 KB of woff2; a
  browser fetches a font only when the page's text uses it).

## Removing a style

Do this twice, once per losing style. Then, optionally, flatten (below).

### Soft-precise hybrid

1. Delete `src/styles/style-hybrid.css` and its import in `src/main.tsx`.
2. In `src/styles/tokens.css`, delete the `[data-style="hybrid"]` shape block
   and both `[data-style="hybrid"][data-theme=…]` colour blocks. **`:root` is
   grouped with them**: add `:root,` to the winner's shape block and to its
   light colour block, so the page still has tokens before `main.tsx` runs.
   Point the `prefers-color-scheme` fallback at the winner's dark `--page`
   and `--text`.
3. `src/app/appearance.ts`: drop `"hybrid"` from `STYLE_NAMES`, and make
   `DEFAULT_APPEARANCE.style` the winner.
4. `src/app/AppearanceControl.tsx`: drop it from `STYLE_LABELS`.
5. Tests: `test/styles/tokens.test.ts` (`STYLES`), `test/app/appearance.test.tsx`.

### Precise

1. Delete `src/styles/style-precise.css` and its import in `src/main.tsx`.
2. `tokens.css`: delete the `[data-style="precise"]` shape block and both
   colour blocks. `--ticks` is used by precise only: remove it from every
   block and from `COLOUR_TOKENS` in the token test. `data-main-card` (on the
   start card, the service card and the result) then marks nothing; remove
   the attribute and its rule in `styles.css`.
3. `src/app/AppFrame.tsx`: the `back` and `context` props and what they
   render, and their computation in `App.tsx`; in `ProcessListScreen.tsx` and
   `ProcessScreen.tsx`, `.service-status`, `.process-key`, `.process-needs`
   and `.process-runs`, and their rule in `styles.css`. Then
   `src/map/MapView.tsx`: the `ScaleControl` and the compass
   (`showCompass: true`) are precise's; set `showCompass: false`, remove the
   scale control, and the rule hiding both in `styles.css`.
4. `src/jobs/JobsPanel.tsx`: the `jobs-head` row of column heads is shown by
   precise only; remove it and its rule in `styles.css`.
5. `src/app/appearance.ts`, `AppearanceControl.tsx` and the tests as for
   hybrid.

### Instrument

1. Delete `src/styles/style-instrument.css` and its import in `src/main.tsx`.
2. `tokens.css`: delete the `[data-style="instrument"]` shape block and both
   colour blocks. `--rail` is used by the rail only: remove it from every
   block and from the token test.
3. `src/app/AppFrame.tsx`: delete `Rail`, `RailItem`, `ICONS`,
   `FramePlace`, `StartLink` and the props only the rail reads (`place`,
   `onConnect`, `onProcesses`, `railItems`, `jobsItem`, `aboutItem`), and the
   branch on `style`. In `src/App.tsx`, delete what computes them.
4. Fonts: remove the Manrope and JetBrains Mono imports from
   `src/styles/fonts.ts`, the two packages from `apps/web/package.json`, and
   their rows in `THIRD_PARTY.md`.
5. Shown by instrument only, so delete them or decide to show them in the
   winner: `.run-hint` and the needs marks (`.needs-mark` in `NeedsTag.tsx`
   and the filters' marks in `ExamplesView.tsx`). If precise goes too, the
   request log (`RequestLog` in `ProcessScreen.tsx`, `src/app/request-log.ts`
   and its rules) goes with them.
6. `src/app/appearance.ts`, `AppearanceControl.tsx` and the tests as for
   hybrid.
7. Breinstein's mark and About: delete `src/app/BrandMark.tsx` (and its
   trademark note in `THIRD_PARTY.md`), its `.start-wordmark` in
   `EndpointScreen.tsx`, `src/app/AboutPanel.tsx`, the About `SidePanel` in
   `App.tsx`, `test/app/about.test.tsx` and `e2e/instrument-breinstein.spec.ts`;
   or move the mark and About into the winner, which then needs a place to
   open About from. `__APP_VERSION__` and `SidePanel`'s `footer` can stay.

### Then, optionally: flatten

With one style left, the style dimension can go: remove `StyleName` and the
style half of `appearance.ts` and the Appearance control (keep the theme
half), stop writing `data-style`, fold the winner's shape block into `:root`
and its colour blocks into `[data-theme="light"]` and `[data-theme="dark"]`,
and move its `style-*.css` rules into `styles.css` without the
`[data-style="…"]` prefix. `AppFrame` keeps the winner's branch.

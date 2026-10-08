# Third-party code and dependencies

Two sections, kept separately because they answer different tender questions.

## 1. Adapted source

Every file in this repository that was derived from another project, however
lightly. One row per file. Record the upstream commit SHA — "latest" is not a
provenance record.

| Our file                                | Upstream project | Repo                                 | Commit SHA                                 | Upstream file                                                                                                    | Licence                 | What we changed                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------- | ------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/relay/src/address-guard.ts`       | GeoLibre         | https://github.com/opengeos/GeoLibre | `abf4badecf98a572dd1e4c0ad87f4f34f2275c2e` | `apps/geolibre-desktop/vite-proxy-guard.ts` (`isPrivateHost`, `isPrivateIPv4`, `isPrivateIPv6`, `guardedLookup`) | MIT, © 2026 Qiusheng Wu | Kept the blocked-range list and the lookup's validate-every-answer and reply-shape handling. Rebuilt the classification on `net.BlockList` instead of hand parsing (which missed the fully expanded IPv4-mapped spelling); added NAT64, 6to4, IPv6 documentation, site-local and multicast ranges; dropped the non-default-port rule, since our allowlist is exact. |
| `apps/relay/test/address-guard.test.ts` | GeoLibre         | https://github.com/opengeos/GeoLibre | `abf4badecf98a572dd1e4c0ad87f4f34f2275c2e` | `tests/edge-proxy-redirect.test.ts` ("Vite proxy guard — validatePublicUrl", "assertResolvedPublicHost")         | MIT, © 2026 Qiusheng Wu | Ported the address cases to vitest against our API; added the spellings and ranges above and the connect-time lookup cases.                                                                                                                                                                                                                                         |

GeoLibre's licence, as required by it for the two GeoLibre rows above:

```
MIT License

Copyright (c) 2026 Qiusheng Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Candidate upstreams for this work: `ogcapi-js`, `ogc-client`, GeoLibre.

## 2. Captured server payloads

Fixtures under `packages/core/test/fixtures/` are responses captured verbatim
from a running server, not adapted source. They are committed so that a change
in upstream behaviour surfaces as a failing test rather than as a silent
behaviour change, and they are excluded from Prettier so they stay byte-exact.

Reproduce a capture by starting the server below and re-running the `curl`
commands in the matching contract test.

| Fixture directory | Server                                                                                    | Image                                                     | Licence                                                                           | Captured                 |
| ----------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `pygeoapi/`       | pygeoapi 0.21.0                                                                           | `geopython/pygeoapi:0.21.0` (a tag, not a digest)         | MIT                                                                               | 2026-08-26 to 2026-10-02 |
| `zoo-project/`    | ZOO-Project, fork `46289f6` (Gouwe-Gozer) on upstream `19f3c4ee`                          | built from that fork: `infra/zoo/pinned.env`              | MIT                                                                               | 2026-08-28 to 2026-10-02 |
| `pdok/`           | PDOK, BAG OGC API Features (`https://api.pdok.nl/kadaster/bag/ogc/v2`), API-Version 2.0.0 | none: a live third-party service, not a server under test | Public Domain Mark 1.0, per the service's own `license` link (checked 2026-10-08) | 2026-09-26               |

The dates and files per capture are in `packages/core/test/fixtures/README.md`.

The web app's form fixtures, `apps/web/test/fixtures/forms/`, are captured the
same way: process descriptions and execute answers from the pinned ZOO-Project
(fork `46289f6`, MIT), captured 2026-10-08, beside execute requests we wrote.
One description there is hand-written. Their README lists each one.

## 3. Dependencies

Regenerate with:

```bash
pnpm licenses list --json > /tmp/licenses.json
```

and fold the result into the table below before each release.

The web build does its own part: `apps/web/vite.config.ts` writes every bundled
package's licence, and those of the packages each depends on, to
`THIRD-PARTY-LICENSES.md` beside the bundle, which deploys with it. Minifying
drops licence comments from the code, and maplibre-gl's BSD-3 licence asks
for its notice to go with a binary. maplibre-gl ships a build that already
holds its own dependencies (pbf, vector-tile, tiny-sdf, unitbezier, earcut and
more), which is why their licences are listed too.

| Package                          | Version | Licence      | Used by                                   |
| -------------------------------- | ------- | ------------ | ----------------------------------------- |
| `maplibre-gl`                    | 6.11.1  | BSD-3-Clause | `apps/web/src/map` only (boundary rule 3) |
| `terra-draw`                     | 1.35.0  | MIT          | `apps/web/src/map` only (boundary rule 3) |
| `terra-draw-maplibre-gl-adapter` | 1.4.1   | MIT          | `apps/web/src/map` only (boundary rule 3) |
| _(the rest: generated)_          |         |              |                                           |

## 4. Data the web app loads at run time

Not code, and not bundled: fetched by the browser while the app runs, and
credited on screen as its licence requires.

| What                                                | From                                                                                                        | Licence               | Credited as                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| BRT-Achtergrondkaart, "standaard" (EPSG:3857 tiles) | PDOK, `https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png` | CC BY 4.0, © Kadaster | "Kaartgegevens © Kadaster (BRT-Achtergrondkaart, CC BY 4.0), via PDOK" |

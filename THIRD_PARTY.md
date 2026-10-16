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

| Fixture directory | Server                                                                                    | Image                                                                                               | Licence                                                                           | Captured                 |
| ----------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `pygeoapi/`       | pygeoapi 0.21.0                                                                           | `geopython/pygeoapi:0.21.0@sha256:34b409a5c4317e3c222ab85068a7ecccd00f50eb5455a149e83cb4e884e132bc` | MIT                                                                               | 2026-08-26 to 2026-10-02 |
| `zoo-project/`    | ZOO-Project, fork `46289f6` (Gouwe-Gozer) on upstream `19f3c4ee`                          | built from that fork: `infra/zoo/pinned.env`                                                        | MIT                                                                               | 2026-08-28 to 2026-10-02 |
| `pdok/`           | PDOK, BAG OGC API Features (`https://api.pdok.nl/kadaster/bag/ogc/v2`), API-Version 2.0.0 | none: a live third-party service, not a server under test                                           | Public Domain Mark 1.0, per the service's own `license` link (checked 2026-10-08) | 2026-09-26               |

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
| `@fontsource/ibm-plex-sans`      | 5.3.0   | OFL-1.1      | `apps/web/src/styles/fonts.ts`            |
| `@fontsource/ibm-plex-mono`      | 5.3.0   | OFL-1.1      | `apps/web/src/styles/fonts.ts`            |
| `@fontsource/manrope`            | 5.3.0   | OFL-1.1      | `apps/web/src/styles/fonts.ts`            |
| `@fontsource/jetbrains-mono`     | 5.3.0   | OFL-1.1      | `apps/web/src/styles/fonts.ts`            |
| _(the rest: generated)_          |         |              |                                           |

## 4. Data the web app loads at run time

Not code, and not bundled: fetched by the browser while the app runs, and
credited on screen as its licence requires.

| What                                                | From                                                                                                        | Licence               | Credited as                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| BRT-Achtergrondkaart, "standaard" (EPSG:3857 tiles) | PDOK, `https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png` | CC BY 4.0, © Kadaster | "Kaartgegevens © Kadaster (BRT-Achtergrondkaart, CC BY 4.0), via PDOK" |

## 5. Trademarks

The Breinstein logo and wordmark, drawn inline in
`apps/web/src/app/BrandMark.tsx` from files Breinstein supplied, are
Breinstein's trademarks. They are not covered by this project's MIT licence
and may not be reused without Breinstein's permission. A fork or a deployment
by anyone else removes them, with `BrandMark.tsx` and the places it is used
(the rail, the start card and the About panel in the instrument style).

## 6. Imagery in the web app

The pictures of Europe behind the instrument style's start screen. Made once
by `apps/web/scripts/fetch-backdrops.sh` and committed as
`apps/web/src/assets/backdrop/europe-day.webp` and `europe-night.webp`: the
build never runs the script, and the page never calls NASA or Wikimedia. They
are not covered by this project's MIT licence. NASA asks to be acknowledged
and not to be presented as endorsing anything; there is no NASA logo.
Credited on screen as "Imagery: NASA Blue Marble and Blue Marble clouds ·
NASA Earth at Night 2012", and in the About panel.

Both pictures share one grid: EPSG:3857, BBOX
`-2782987,3895304,5009377,11753185` (lon −25…45°, lat 33…72°), 2400 × 2420 px.
The GDAL steps run in `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3`, pinned by
digest in the script.

### Europe by day: NASA Blue Marble, from GIBS

- **Acknowledgement**, as GIBS asks
  (<https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api>):
  "We acknowledge the use of imagery provided by services from NASA's Global
  Imagery Browse Services (GIBS), part of NASA's Earth Science Data and
  Information System (ESDIS)."
- **Request:** one WMS 1.3.0 GetMap, `image/png`, from
  `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi`, layer
  `BlueMarble_NextGeneration` (no time dimension), `CRS=EPSG:3857`, the BBOX
  and size above.
- **Fetched** 2026-10-16. GIBS draws the picture on request, so there is no
  published hash; the PNG behind the committed picture had SHA-256
  `9e9e406cd00d8be0a644a7f077441a1d5924f161b67578e1802a32fd8b883b10`. The
  script prints the hash of each fetch, so a rerun shows whether it got the
  same picture.
- **Clouds** blended in before encoding (below).
- **WebP:** lossy, quality 60, method 6: 401 KB.

### Clouds: NASA Blue Marble clouds

- **Page:** <https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/>
  (Visible Earth id 57747).
- **File:** `https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif`,
  8192 × 4096 px, 35 870 468 bytes, SHA-256
  `d137775d8966ab8d443fd5126dc6e7ad72072bc1ed50555c5818d221735daf0f`
  (checked by the script). Downloaded by the script only; never committed.
- **Credit**, from NASA's page: "Credits: NASA Goddard Space Flight Center.
  Image by Reto Stöckli (land surface, shallow water, clouds). Enhancements by
  Robert Simmon (ocean color, compositing, 3D globes, animation)."
- **Blend**, per pixel, with strength 0.7 and exponent 0.8:
  `c = cloud / 255`; `a = 0.7 × c^0.8`; `out = day × (1 − a) + rgb(248 249 250) × a`.

### Europe by night: NASA Earth at Night 2012

- **Page:** <https://commons.wikimedia.org/wiki/File:The_earth_at_night.jpg>
- **File:** `https://upload.wikimedia.org/wikipedia/commons/b/ba/The_earth_at_night.jpg`,
  13 500 × 6 750 px, 7 813 537 bytes, SHA-256
  `43b8c6cb6fdab028cb24478e431022df2e01fc62b39e5a01be004d4130cc01f2`
  (checked by the script).
- **Licence**, as the Commons page states it: public domain.
- **Credit:** NASA Earth Observatory. Original source: NASA's Earth at Night
  2012 (<http://earthobservatory.nasa.gov/NaturalHazards/view.php?id=79765>).
- **GDAL** (the cloud map takes the same three steps):

  ```sh
  gdal_translate -of VRT -a_srs EPSG:4326 -a_ullr -180 90 180 -90 night.jpg night-4326.vrt
  gdalwarp -t_srs EPSG:3857 -te -2782987 3895304 5009377 11753185 \
    -ts 2400 2420 -r lanczos night-4326.vrt night-3857.tif
  gdal_translate -of PNG night-3857.tif night.png
  ```

- **WebP:** lossy, quality 50, method 6: 398 KB.

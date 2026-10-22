#!/usr/bin/env bash
#
# The two pictures behind Instrument's start screen: Europe by day (NASA Blue
# Marble, with NASA's Blue Marble clouds blended in) and by night (NASA Earth
# at Night 2012). Writes src/assets/backdrop/europe-day.webp and
# europe-night.webp, which are committed: the build and CI never run this,
# and the page never calls NASA or Wikimedia.
#
# Needs only Docker, curl and shasum on the host. Everything else runs in one
# GDAL image, pinned by tag and digest. Downloads go to a temporary folder,
# never into the repository. Sources and credits: THIRD_PARTY.md.
#
#   apps/web/scripts/fetch-backdrops.sh
#
# Both pictures sit on one grid, so switching theme swaps the picture without
# anything moving: Web Mercator (EPSG:3857, as MapLibre draws), lon -25..45°,
# lat 33..72° (Iceland to Cyprus), 2400 x 2420 px, the extent's aspect.

set -euo pipefail

GDAL_IMAGE="ghcr.io/osgeo/gdal:ubuntu-small-3.13.3@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40"

# The shared grid: xmin ymin xmax ymax in metres, and the size in pixels.
XMIN=-2782987 YMIN=3895304 XMAX=5009377 YMAX=11753185
WIDTH=2400 HEIGHT=2420

# Day: one WMS GetMap from NASA GIBS. WMS 1.3.0 with EPSG:3857 takes x,y
# (easting, northing). PNG, so the WebP encode is the only lossy step.
DAY_URL="https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=BlueMarble_NextGeneration&STYLES=&CRS=EPSG:3857&BBOX=${XMIN},${YMIN},${XMAX},${YMAX}&WIDTH=${WIDTH}&HEIGHT=${HEIGHT}&FORMAT=image/png"

# Clouds: NASA's Blue Marble cloud map (Visible Earth 57747), a greyscale world
# map in lon/lat, white where cloudy.
CLOUD_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif"
CLOUD_SHA256="d137775d8966ab8d443fd5126dc6e7ad72072bc1ed50555c5818d221735daf0f"
# The blend, per pixel: c = cloud / 255; a = STRENGTH * c^EXPONENT;
# out = day * (1 - a) + CLOUD_RGB * a. Change these two to retune, then rerun.
CLOUD_STRENGTH=0.7
CLOUD_EXPONENT=0.8
CLOUD_RGB="248 249 250"

# Night: NASA Earth at Night 2012, a lon/lat world map, from Wikimedia Commons.
NIGHT_URL="https://upload.wikimedia.org/wikipedia/commons/b/ba/The_earth_at_night.jpg"
NIGHT_SHA256="43b8c6cb6fdab028cb24478e431022df2e01fc62b39e5a01be004d4130cc01f2"

# WebP: lossy, slowest and smallest method. Budget: 450 KB each.
DAY_QUALITY=60
NIGHT_QUALITY=50

for tool in docker curl shasum; do
  command -v "$tool" >/dev/null || {
    echo "fetch-backdrops: needs $tool" >&2
    exit 1
  }
done

OUT="$(cd "$(dirname "$0")/.." && pwd)/src/assets/backdrop"
mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A file, refused unless its SHA-256 is the one recorded here.
fetch_checked() {
  local url=$1 file=$2 sha=$3
  echo "fetching $url"
  curl --fail --silent --show-error --location -o "$WORK/$file" "$url"
  local got
  got=$(shasum -a 256 "$WORK/$file" | cut -d' ' -f1)
  if [ "$got" != "$sha" ]; then
    echo "fetch-backdrops: $file has SHA-256 $got, expected $sha" >&2
    exit 1
  fi
}

# 1. Day. A WMS can report an error as XML with status 200: check the type.
echo "fetching the day image from GIBS"
type=$(curl --fail --silent --show-error -o "$WORK/day.png" -w '%{content_type}' "$DAY_URL")
if [ "$type" != "image/png" ]; then
  echo "fetch-backdrops: GIBS answered $type, not image/png:" >&2
  head -c 600 "$WORK/day.png" >&2
  exit 1
fi
# GIBS draws the map on request, so there is no hash to check it against.
# Print it instead: THIRD_PARTY.md records the one behind the committed image.
echo "GIBS PNG SHA-256 $(shasum -a 256 "$WORK/day.png" | cut -d' ' -f1), $(date -u +%Y-%m-%d)"

# 2 and 3. The cloud map and the night picture.
fetch_checked "$CLOUD_URL" clouds.tif "$CLOUD_SHA256"
fetch_checked "$NIGHT_URL" night.jpg "$NIGHT_SHA256"

# Then everything else in the GDAL image, as the host's own user.
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$WORK:/work" -v "$OUT:/out" \
  -e XMIN="$XMIN" -e YMIN="$YMIN" -e XMAX="$XMAX" -e YMAX="$YMAX" \
  -e WIDTH="$WIDTH" -e HEIGHT="$HEIGHT" \
  -e CLOUD_STRENGTH="$CLOUD_STRENGTH" -e CLOUD_EXPONENT="$CLOUD_EXPONENT" -e CLOUD_RGB="$CLOUD_RGB" \
  -e DAY_QUALITY="$DAY_QUALITY" -e NIGHT_QUALITY="$NIGHT_QUALITY" \
  "$GDAL_IMAGE" bash -euo pipefail -c '
cd /work

# Onto the shared grid. Neither file says where it lies, so tell GDAL first:
# a lon/lat world map, upper left -180,90, lower right 180,-90. Then cut out
# Europe and warp it to Web Mercator, and copy the result to PNG.
to_grid() {
  gdal_translate -q -of VRT -a_srs EPSG:4326 -a_ullr -180 90 180 -90 "$1" "$2-4326.vrt"
  gdalwarp -q -overwrite -t_srs EPSG:3857 -te "$XMIN" "$YMIN" "$XMAX" "$YMAX" \
    -ts "$WIDTH" "$HEIGHT" -r lanczos "$2-4326.vrt" "$2-3857.tif"
  gdal_translate -q -of PNG "$2-3857.tif" "$2.png"
}
to_grid clouds.tif clouds
to_grid night.jpg night

# The clouds, blended into the day picture.
python3 - <<"PY"
import os
import numpy as np
from osgeo import gdal

gdal.UseExceptions()
day = gdal.Open("day.png").ReadAsArray()[:3].astype(np.float64)  # RGB(A): the colour bands
cloud = gdal.Open("clouds.png").ReadAsArray()
cloud = (cloud[0] if cloud.ndim == 3 else cloud).astype(np.float64) / 255
if day.shape[1:] != cloud.shape:
    raise SystemExit(f"day {day.shape[1:]} and clouds {cloud.shape} are not on one grid")
a = float(os.environ["CLOUD_STRENGTH"]) * cloud ** float(os.environ["CLOUD_EXPONENT"])
white = np.array([float(v) for v in os.environ["CLOUD_RGB"].split()]).reshape(3, 1, 1)
out = np.clip(np.rint(day * (1 - a) + white * a), 0, 255).astype(np.uint8)
mem = gdal.GetDriverByName("MEM").Create("", out.shape[2], out.shape[1], 3, gdal.GDT_Byte)
for band in range(3):
    mem.GetRasterBand(band + 1).WriteArray(out[band])
gdal.GetDriverByName("PNG").CreateCopy("day-clouds.png", mem)
PY

gdal_translate -q -of WEBP -co QUALITY="$DAY_QUALITY" -co METHOD=6 day-clouds.png /out/europe-day.webp
gdal_translate -q -of WEBP -co QUALITY="$NIGHT_QUALITY" -co METHOD=6 night.png /out/europe-night.webp
rm -f /out/*.aux.xml
'

ls -l "$OUT"/europe-day.webp "$OUT"/europe-night.webp | awk '{ printf "%s  %d KB\n", $NF, ($5 + 1023) / 1024 }'

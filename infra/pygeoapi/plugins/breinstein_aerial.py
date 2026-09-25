# =================================================================
#
# A pygeoapi process with a GeoJSON polygon going in and a picture of that
# area coming out, for the oap-client web client's result rendering.
#
# Why this exists
# ---------------
# `breinstein-png` returns an image, but a generated one of no place. Nothing
# on the CORS-enabled port returns an image *of somewhere*, so an image result
# had no reason to be anywhere but a download. This one returns the current
# aerial photograph of the polygon's bounding box, and that bounding box
# beside it, so a client can put the picture on a map where it belongs.
#
# Where the picture comes from
# ----------------------------
# PDOK's `luchtfotorgb` WMS, layer `Actueel_orthoHR`: Beeldmateriaal
# Nederland's most recent country-wide aerial photograph, 8 cm per pixel,
# published as open data with no key, no fees and no access constraints
# (checked in its capabilities, 2026-09-25). It covers the Netherlands only,
# so a polygon outside that is refused rather than answered with a blank
# picture. This is the one process here that reaches the network; it is not
# used by the contract lane, and its browser test skips when PDOK is not
# answering.
#
# The picture is asked for in EPSG:3857, the projection web maps draw in, so
# that its four corners, given back in CRS84, place it on such a map without
# resampling. Its longer side is 1024 pixels, and its shape follows the
# bounding box's.
#
# Two outputs, one results map
# ----------------------------
# `image` is the JPEG, base64-encoded in a qualified value (the standard's way
# of carrying binary in JSON), and `bbox` is the area it covers, shaped as
# the OGC `bbox.yaml` schema. Both together come back as one JSON results
# map, because a pygeoapi processor returns one media type and one payload.
# Ask for `image` alone and it comes back raw as `image/jpeg`; ask for `bbox`
# alone and it comes back as its JSON object.
#
# The standard has no way to say that one output is the extent of another.
# That the box is the picture's is this description's word, in its output
# descriptions; a client that pairs them is reading, not being told.
#
# The polygon is read as `breinstein-rotate` reads it: from a qualified
# value's `value` (finding 0052) or bare.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import base64
import logging
import math
import urllib.error
import urllib.parse
import urllib.request

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'

PDOK_WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
PDOK_LAYER = 'Actueel_orthoHR'

#: The layer's extent, west, south, east, north, from its capabilities.
COVERAGE = (3.170655, 50.578824, 7.488737, 53.637608)

#: The picture's longer side, in pixels. PDOK allows up to 2500.
LONG_SIDE = 1024

#: The widest area asked for, in metres on the ground. At 1024 pixels that
#: is about 25 m per pixel: an aerial photograph is no use beyond it.
MAX_SPAN_M = 25_000

#: The narrowest, so the picture is of an area and not of a line.
MIN_SPAN_M = 10

EARTH_RADIUS = 6_378_137.0

TIMEOUT_S = 30

BBOX_SCHEMA = {
    'type': 'object',
    'format': 'ogc-bbox',
    'required': ['bbox'],
    'properties': {
        'bbox': {
            'type': 'array',
            'minItems': 4,
            'maxItems': 4,
            'items': {
                'type': 'number'
            }
        },
        'crs': {
            'type': 'string',
            'format': 'uri',
            'enum': [CRS84]
        }
    }
}

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-aerial',
    'title': {
        'en': 'Aerial photograph of an area'
    },
    'description': {
        'en': 'Takes one GeoJSON polygon in the Netherlands and returns the '
              'current aerial photograph of its bounding box, with that box. '
              'Imagery: Beeldmateriaal Nederland, Luchtfoto Actueel Ortho '
              '8cm RGB, open data, via PDOK.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['geojson', 'image', 'aerial photograph', 'testbed'],
    'links': [{
        'type': 'text/xml',
        'rel': 'related',
        'title': 'The imagery source: PDOK Luchtfoto RGB (WMS capabilities)',
        'href': 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0'
                '?request=GetCapabilities&service=WMS'
    }],
    'inputs': {
        'area': {
            'title': 'Area',
            'description': 'A GeoJSON Polygon geometry in the Netherlands, '
                           'at most 25 km across, as a qualified value or '
                           'bare. The photograph covers its bounding box.',
            'schema': {
                'type': 'object',
                'format': 'geojson-polygon',
                'required': ['type', 'coordinates'],
                'properties': {
                    'type': {
                        'type': 'string',
                        'enum': ['Polygon']
                    },
                    'coordinates': {
                        'type': 'array',
                        'minItems': 1,
                        'items': {
                            'type': 'array',
                            'minItems': 4,
                            'items': {
                                'type': 'array',
                                'minItems': 2,
                                'items': {
                                    'type': 'number'
                                }
                            }
                        }
                    }
                }
            },
            'minOccurs': 1,
            'maxOccurs': 1,
            'keywords': ['geojson']
        }
    },
    'outputs': {
        'image': {
            'title': 'Aerial photograph',
            'description': 'The photograph of the area in "bbox", 1024 '
                           'pixels on its longer side, in Web Mercator '
                           '(EPSG:3857).',
            'schema': {
                'type': 'string',
                'contentEncoding': 'base64',
                'contentMediaType': 'image/jpeg'
            }
        },
        'bbox': {
            'title': 'Area of the photograph',
            'description': 'The bounding box of the input polygon, which is '
                           'exactly the area "image" shows, in CRS84.',
            'schema': BBOX_SCHEMA
        }
    },
    'example': {
        'inputs': {
            'area': {
                'value': {
                    'type': 'Polygon',
                    'coordinates': [[
                        [5.10, 52.08],
                        [5.14, 52.08],
                        [5.14, 52.10],
                        [5.10, 52.10],
                        [5.10, 52.08]
                    ]]
                },
                'mediaType': 'application/geo+json'
            }
        }
    }
}


def _is_number(value):
    return (not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(value))


def _read_box(value):
    """The polygon's bounding box, or a ProcessorExecuteError saying why not."""

    # A qualified value: the polygon is its `value` (finding 0052).
    if isinstance(value, dict) and 'value' in value and 'type' not in value:
        value = value['value']

    if not isinstance(value, dict) or value.get('type') != 'Polygon':
        found = (value.get('type') if isinstance(value, dict)
                 else type(value).__name__)
        raise ProcessorExecuteError(
            'The "area" input must be a GeoJSON Polygon geometry; '
            f'received "{found}"')

    rings = value.get('coordinates')
    if not isinstance(rings, list) or len(rings) == 0:
        raise ProcessorExecuteError(
            'The "area" input must have at least one ring')
    exterior = rings[0]
    if not isinstance(exterior, list) or len(exterior) < 4:
        raise ProcessorExecuteError(
            'The "area" input\'s outer ring must have at least four positions')
    for position in exterior:
        if (not isinstance(position, list)
                or len(position) < 2
                or not all(_is_number(n) for n in position)):
            raise ProcessorExecuteError(
                'Every position of the "area" input must be an array of two '
                'or more numbers')

    xs = [position[0] for position in exterior]
    ys = [position[1] for position in exterior]
    return min(xs), min(ys), max(xs), max(ys)


def _mercator(lon, lat):
    x = EARTH_RADIUS * math.radians(lon)
    y = EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def _check_area(west, south, east, north):
    cw, cs, ce, cn = COVERAGE
    if west < cw or south < cs or east > ce or north > cn:
        raise ProcessorExecuteError(
            'The "area" input must lie within the Netherlands (longitude '
            f'{cw:.2f} to {ce:.2f}, latitude {cs:.2f} to {cn:.2f}); the '
            'aerial photograph covers nothing else')

    scale = math.cos(math.radians((south + north) / 2))
    x1, y1 = _mercator(west, south)
    x2, y2 = _mercator(east, north)
    wide = (x2 - x1) * scale
    high = (y2 - y1) * scale
    if max(wide, high) > MAX_SPAN_M:
        raise ProcessorExecuteError(
            f'The "area" input is {max(wide, high) / 1000:.1f} km across; at '
            f'most {MAX_SPAN_M / 1000:.0f} km is photographed')
    if min(wide, high) < MIN_SPAN_M:
        raise ProcessorExecuteError(
            'The "area" input must be at least '
            f'{MIN_SPAN_M} m across in both directions')

    return (x1, y1, x2, y2)


def _size(x1, y1, x2, y2):
    """Width and height in pixels: the longer side LONG_SIDE, the shape kept."""

    wide, high = x2 - x1, y2 - y1
    if wide >= high:
        return LONG_SIDE, max(1, round(LONG_SIDE * high / wide))
    return max(1, round(LONG_SIDE * wide / high)), LONG_SIDE


def _fetch(x1, y1, x2, y2):
    width, height = _size(x1, y1, x2, y2)
    query = urllib.parse.urlencode({
        'SERVICE': 'WMS',
        'VERSION': '1.3.0',
        'REQUEST': 'GetMap',
        'LAYERS': PDOK_LAYER,
        'STYLES': '',
        'CRS': 'EPSG:3857',
        'BBOX': f'{x1},{y1},{x2},{y2}',
        'WIDTH': width,
        'HEIGHT': height,
        'FORMAT': 'image/jpeg'
    })
    url = f'{PDOK_WMS}?{query}'
    LOGGER.debug(f'Fetching {url}')
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
            body = response.read()
            media_type = response.headers.get_content_type()
    except (urllib.error.URLError, TimeoutError) as error:
        raise ProcessorExecuteError(
            f'The aerial photograph could not be fetched from PDOK: {error}')

    # A WMS reports its own errors as a 200 with an XML exception document.
    if media_type != 'image/jpeg' or not body.startswith(b'\xff\xd8'):
        raise ProcessorExecuteError(
            f'PDOK answered with {media_type} instead of a JPEG: '
            f'{body[:200].decode("utf-8", "replace")}')
    return body


class AerialProcessor(BaseProcessor):
    """Photographs an area. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_aerial.AerialProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        wanted = set(outputs) if bool(outputs) else {'image', 'bbox'}

        west, south, east, north = _read_box(data.get('area'))
        mercator = _check_area(west, south, east, north)
        box = {'bbox': [west, south, east, north], 'crs': CRS84}

        if wanted == {'bbox'}:
            return 'application/json', box

        jpeg = _fetch(*mercator)
        if wanted == {'image'}:
            return 'image/jpeg', jpeg

        return 'application/json', {
            'image': {
                'value': base64.b64encode(jpeg).decode('ascii'),
                'mediaType': 'image/jpeg',
                'encoding': 'base64'
            },
            'bbox': box
        }

    def __repr__(self):
        return f'<AerialProcessor> {self.name}'

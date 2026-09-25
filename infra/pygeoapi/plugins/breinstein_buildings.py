# =================================================================
#
# A pygeoapi process with a GeoJSON polygon going in and the buildings in it
# coming out, from PDOK's BAG OGC API Features, for the oap-client web
# client's result rendering and for demonstrating it.
#
# Why this exists
# ---------------
# Two things nothing else here does:
#
# - A **large** GeoJSON result: a few hundred metres of a Dutch town is
#   hundreds of buildings and a megabyte or more, which is what real
#   processes return and what the web client's display limit has to cope
#   with.
# - An output **by reference**. Ask for `buildings` with `transmissionMode:
#   "reference"` and it comes back as a link to the OGC API Features query
#   instead of the features: the collection reference a client should be
#   able to follow. pygeoapi itself ignores a requested transmission mode
#   (finding 0028), but it hands the request to the process, so this one
#   honours it. The link is a bounding-box query, so it can hold buildings
#   near the polygon that the inline answer leaves out.
#
# It is also the one process here that looks like an application, which is
# why it is named for what it returns: for a demo, "draw an area, get its
# buildings" shows a generated form, a map and a result in one go.
#
# Where the buildings come from
# -----------------------------
# PDOK's `bag` OGC API Features v2, collection `pand`: Kadaster's register of
# buildings, open data with no key. Inline, the process pages through the
# bounding-box query (1 000 per page, at most 5 pages) and keeps the buildings
# that intersect the polygon; the result says if it stopped early. An area
# outside the Netherlands or more than 1 km across is refused.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import json
import logging
import math
import urllib.error
import urllib.parse
import urllib.request

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError
from shapely.geometry import shape

LOGGER = logging.getLogger(__name__)

ITEMS = 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items'

#: The Netherlands, west, south, east, north, roughly: BAG covers nothing else.
COVERAGE = (3.2, 50.7, 7.3, 53.6)

MAX_SPAN_M = 1_000
PAGE_SIZE = 1_000
MAX_PAGES = 5
TIMEOUT_S = 30

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-buildings',
    'title': {
        'en': 'Buildings in an area'
    },
    'description': {
        'en': 'Takes one GeoJSON polygon in the Netherlands and returns the '
              'buildings that intersect it, as GeoJSON, or as a link to the '
              'query when asked for by reference. Buildings: Kadaster, BAG, '
              'open data, via PDOK OGC API Features.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'outputTransmission': ['value', 'reference'],
    'keywords': ['geojson', 'buildings', 'BAG', 'testbed'],
    'links': [{
        'type': 'application/json',
        'rel': 'related',
        'title': 'The source: PDOK BAG OGC API Features, collection "pand"',
        'href': 'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand'
    }],
    'inputs': {
        'area': {
            'title': 'Area',
            'description': 'A GeoJSON Polygon geometry in the Netherlands, at '
                           'most 1 km across, as a qualified value or bare.',
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
        'buildings': {
            'title': 'Buildings',
            'description': 'The buildings that intersect the area, as a '
                           'GeoJSON FeatureCollection; by reference, a link '
                           'to the bounding-box query they came from.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/geo+json'
            }
        }
    },
    'example': {
        'inputs': {
            'area': {
                'value': {
                    'type': 'Polygon',
                    'coordinates': [[
                        [5.118, 52.089],
                        [5.124, 52.089],
                        [5.124, 52.093],
                        [5.118, 52.093],
                        [5.118, 52.089]
                    ]]
                },
                'mediaType': 'application/geo+json'
            }
        }
    }
}


def _read_area(value):
    """The polygon as a shapely shape, or a ProcessorExecuteError saying why not."""

    # A qualified value: the polygon is its `value` (finding 0052).
    if isinstance(value, dict) and 'value' in value and 'type' not in value:
        value = value['value']
    if not isinstance(value, dict) or value.get('type') != 'Polygon':
        found = (value.get('type') if isinstance(value, dict)
                 else type(value).__name__)
        raise ProcessorExecuteError(
            'The "area" input must be a GeoJSON Polygon geometry; '
            f'received "{found}"')
    try:
        polygon = shape(value)
    except Exception as error:  # however shapely says the geometry is broken
        raise ProcessorExecuteError(f'The "area" input is malformed: {error}')
    if polygon.is_empty:
        raise ProcessorExecuteError('The "area" input is empty')

    west, south, east, north = polygon.bounds
    cw, cs, ce, cn = COVERAGE
    if west < cw or south < cs or east > ce or north > cn:
        raise ProcessorExecuteError(
            'The "area" input must lie within the Netherlands; the register '
            'of buildings covers nothing else')
    metres_per_degree = 111_320
    wide = (east - west) * metres_per_degree * math.cos(
        math.radians((south + north) / 2))
    high = (north - south) * metres_per_degree
    if max(wide, high) > MAX_SPAN_M:
        raise ProcessorExecuteError(
            f'The "area" input is {max(wide, high):.0f} m across; at most '
            f'{MAX_SPAN_M} m is searched')
    return polygon


def _query(polygon):
    west, south, east, north = polygon.bounds
    return ITEMS + '?' + urllib.parse.urlencode({
        'f': 'json',
        'bbox': f'{west},{south},{east},{north}',
        'limit': PAGE_SIZE
    })


def _get(url):
    request = urllib.request.Request(
        url, headers={'Accept': 'application/geo+json'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise ProcessorExecuteError(
            f'The buildings could not be fetched from PDOK: {error}')


def _buildings(polygon, query):
    kept = []
    url = query
    pages = 0
    truncated = False
    while url is not None:
        if pages == MAX_PAGES:
            truncated = True
            break
        page = _get(url)
        pages += 1
        for feature in page.get('features') or []:
            geometry = feature.get('geometry')
            if geometry is not None and shape(geometry).intersects(polygon):
                kept.append(feature)
        url = next((link.get('href') for link in page.get('links') or []
                    if link.get('rel') == 'next'), None)
    return {
        'type': 'FeatureCollection',
        'source': {'query': query, 'pages': pages, 'truncated': truncated},
        'features': kept
    }


class BuildingsProcessor(BaseProcessor):
    """Finds buildings. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_buildings.BuildingsProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        polygon = _read_area(data.get('area'))
        query = _query(polygon)

        requested = (outputs or {}).get('buildings') or {}
        if isinstance(requested, dict) \
                and requested.get('transmissionMode') == 'reference':
            return 'application/json', {
                'buildings': {
                    'href': query,
                    'type': 'application/geo+json',
                    'rel': 'related',
                    'title': 'The buildings in the bounding box of the area'
                }
            }

        return 'application/geo+json', _buildings(polygon, query)

    def __repr__(self):
        return f'<BuildingsProcessor> {self.name}'

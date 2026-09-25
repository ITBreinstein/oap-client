# =================================================================
#
# A pygeoapi process with a GeoJSON FeatureCollection going in — by value or
# by reference — and the same features with their area coming out, as GeoJSON
# and as a CSV table, for the oap-client web client's forms and results.
#
# Why this exists
# ---------------
# Three holes at once, each one the web client had no live server for:
#
# - An input given **by reference**. The form offers "Give a URL for the
#   server to fetch" on every complex input, but no process on the pinned
#   pygeoapi took one, so that path had only been sent to ZOO.
# - A **FeatureCollection** in and out, with properties. Every geometry sent
#   so far was bare, and every GeoJSON result carried no attributes.
# - A **CSV** output, beside a GeoJSON one, in one results map; asked for
#   alone, it comes back raw as `text/csv`.
#
# By reference
# ------------
# The standard has the server resolve a reference and treat what it fetched
# as if it had been sent inline (OGC 18-062r2 Requirement 18 B, Requirement
# 24 B). pygeoapi does not: it hands the process `{"href": …}` as it arrived
# (finding 0058). So this process fetches it — https or http only, 30 seconds,
# 10 MB — and says in its output where the features came from. That is the
# server's job done here because pygeoapi does not do it; the finding stands,
# and `breinstein-inputs` still shows the reference arriving unresolved.
#
# The input is declared the way the standard describes a complex input: a
# `oneOf` of its encodings, a JSON object or GeoJSON text. A qualified value's
# `value` is read as the collection (finding 0052), and GeoJSON text is
# parsed.
#
# The area
# --------
# Geodesic, on the WGS 84 ellipsoid (pyproj's `Geod`), in square metres, so it
# is right wherever the features are, with no projection chosen. Polygons and
# multipolygons have one; any other geometry gets `null`. The one piece of
# arithmetic, and it is a library's.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import csv
import io
import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError
from pyproj import Geod
from shapely.geometry import shape

LOGGER = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT_S = 30
MAX_FEATURES = 10_000

GEOD = Geod(ellps='WGS84')

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-feature-area',
    'title': {
        'en': 'Area of each feature'
    },
    'description': {
        'en': 'Takes a GeoJSON FeatureCollection, inline or as a URL to fetch, '
              'and returns the same features with their geodesic area in '
              'square metres added, as GeoJSON and as a CSV table.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['geojson', 'feature collection', 'area', 'csv', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'features': {
            'title': 'Features',
            'description': 'A GeoJSON FeatureCollection in longitude and '
                           'latitude: inline, or a URL the process fetches '
                           '(at most 10 MB and 10 000 features).',
            'schema': {
                'oneOf': [
                    {
                        'type': 'object'
                    },
                    {
                        'type': 'string',
                        'contentMediaType': 'application/geo+json'
                    }
                ]
            },
            'minOccurs': 1,
            'maxOccurs': 1,
            'keywords': ['geojson']
        }
    },
    'outputs': {
        'features': {
            'title': 'Features with their area',
            'description': 'The input features, each with "area_m2" added to '
                           'its properties (null for a geometry with no '
                           'area), and "source" saying where they came from.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/geo+json'
            }
        },
        'table': {
            'title': 'Table',
            'description': 'One row per feature: its number, its id, its '
                           'geometry type, its area, and every property; a '
                           'property that is not a single value is written '
                           'as JSON.',
            'schema': {
                'type': 'string',
                'contentMediaType': 'text/csv'
            }
        }
    },
    'example': {
        'inputs': {
            'features': {
                'value': {
                    'type': 'FeatureCollection',
                    'features': [{
                        'type': 'Feature',
                        'id': 'block',
                        'properties': {'name': 'a block in Utrecht'},
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [[
                                [5.118, 52.089],
                                [5.124, 52.089],
                                [5.124, 52.093],
                                [5.118, 52.093],
                                [5.118, 52.089]
                            ]]
                        }
                    }]
                },
                'mediaType': 'application/geo+json'
            }
        }
    }
}


def _fetch(href):
    scheme = urllib.parse.urlparse(href).scheme
    if scheme not in ('http', 'https'):
        raise ProcessorExecuteError(
            f'The "features" reference must be an http or https URL; '
            f'received "{href}"')
    request = urllib.request.Request(
        href, headers={'Accept': 'application/geo+json, application/json'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = response.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise ProcessorExecuteError(
            f'The "features" reference could not be fetched: {error}')
    if len(body) > MAX_BYTES:
        raise ProcessorExecuteError(
            'The "features" reference is larger than 10 MB')
    try:
        return json.loads(body)
    except ValueError:
        raise ProcessorExecuteError(
            'The "features" reference did not return JSON')


def _read_collection(value):
    """The FeatureCollection and where it came from, or an error saying why not."""

    source = {'by': 'value'}
    if isinstance(value, dict) and 'href' in value and 'features' not in value:
        # By reference: a link, whose `type` is a media type, not GeoJSON's.
        # pygeoapi passes it through unresolved (finding 0058).
        href = value.get('href')
        if not isinstance(href, str):
            raise ProcessorExecuteError(
                'The "features" reference must carry an "href" string')
        source = {'by': 'reference', 'href': href}
        value = _fetch(href)
    elif isinstance(value, dict) and 'value' in value and 'features' not in value:
        # A qualified value: the collection is its `value` (finding 0052).
        value = value['value']

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            raise ProcessorExecuteError(
                'The "features" input is text, but not GeoJSON')

    if not isinstance(value, dict) or value.get('type') != 'FeatureCollection':
        found = (value.get('type') if isinstance(value, dict)
                 else type(value).__name__)
        raise ProcessorExecuteError(
            'The "features" input must be a GeoJSON FeatureCollection; '
            f'received "{found}"')
    features = value.get('features')
    if not isinstance(features, list):
        raise ProcessorExecuteError(
            'The "features" input must have a "features" array')
    if len(features) > MAX_FEATURES:
        raise ProcessorExecuteError(
            f'The "features" input has {len(features)} features; at most '
            f'{MAX_FEATURES} are measured')
    return features, source


def _area(geometry):
    if not isinstance(geometry, dict) \
            or geometry.get('type') not in ('Polygon', 'MultiPolygon'):
        return None
    try:
        area, _ = GEOD.geometry_area_perimeter(shape(geometry))
    except Exception as error:  # a malformed geometry, however shapely says so
        raise ProcessorExecuteError(f'A feature has a malformed geometry: {error}')
    # Positive whichever way the rings wind.
    return round(abs(area), 2)


def _cell(value):
    """A property as one CSV cell: a single value as itself, anything else as JSON."""

    if value is None:
        return ''
    if isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False)


def _table(features):
    columns = []
    for feature in features:
        for key in (feature.get('properties') or {}):
            if key != 'area_m2' and key not in columns:
                columns.append(key)

    out = io.StringIO()
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(['number', 'id', 'geometry', 'area_m2', *columns])
    for number, feature in enumerate(features, start=1):
        properties = feature.get('properties') or {}
        geometry = feature.get('geometry') or {}
        writer.writerow([
            number,
            feature.get('id', ''),
            geometry.get('type', ''),
            _cell(properties.get('area_m2')),
            *[_cell(properties.get(key)) for key in columns]
        ])
    return out.getvalue()


class FeatureAreaProcessor(BaseProcessor):
    """Measures features. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_feature_area.FeatureAreaProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        wanted = set(outputs) if bool(outputs) else {'features', 'table'}

        features, source = _read_collection(data.get('features'))
        measured = []
        for feature in features:
            if not isinstance(feature, dict) or feature.get('type') != 'Feature':
                raise ProcessorExecuteError(
                    'Every member of "features" must be a GeoJSON Feature')
            properties = dict(feature.get('properties') or {})
            properties['area_m2'] = _area(feature.get('geometry'))
            measured.append({**feature, 'properties': properties})

        collection = {
            'type': 'FeatureCollection',
            'source': source,
            'features': measured
        }

        if wanted == {'table'}:
            return 'text/csv', _table(measured).encode('utf-8')
        if wanted == {'features'}:
            return 'application/geo+json', collection

        return 'application/json', {
            'features': collection,
            'table': _table(measured)
        }

    def __repr__(self):
        return f'<FeatureAreaProcessor> {self.name}'

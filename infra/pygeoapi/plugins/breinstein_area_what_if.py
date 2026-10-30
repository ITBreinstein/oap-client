# =================================================================
#
# A pygeoapi process described the way the Beleidsnormen API (a Dutch testbed
# server, captured in packages/core/test/fixtures/beleidsnormen/) describes its
# processes: an area, and a repeatable "what-if" layer of points. It counts the
# points inside the area and measures the area, for the oap-client web client's
# GeoJSON inputs.
#
# Why this exists
# ---------------
# The web client reads two GeoJSON shapes no reference server sent before:
#
# - `geometry`: a `oneOf` of a structural Polygon and MultiPolygon, each
#   branch with `format: "geojson-geometry"` and `contentMediaType`, copied
#   from the Beleidsnormen API's `regel_30.geometry` — its `example` too, in
#   that server's `{ value, format: { mediatype } }` form, with CRS84
#   coordinates in place of its RD New ones.
# - `nieuwe_punten`: a structural FeatureCollection of Points, with no format
#   and no `$ref`, `maxOccurs: "unbounded"`, copied from its
#   `rustplekken.nieuwe_bankjes`.
#
# The Beleidsnormen API cannot be reached from a web page (no CORS headers)
# and is someone else's dev server, so the blocking lane tests against this.
#
# What it does, and what it reports
# ---------------------------------
# A spec-correct server takes a repeatable input as an array, "even if the
# input consists of a single value" (/req/core/process-execute-input-array),
# and may take a lone value too. So `nieuwe_punten` is read either way, bare
# or as a qualified value (pygeoapi hands the process the wrapper, finding
# 0052), and `points_as` says which arrived: "array", "single" or "absent".
# That is how a browser test can see what was sent from what arrived.
#
# The count is of points inside the area, or on its edge (shapely's
# `covers`). The area is geodesic, on the WGS 84 ellipsoid (pyproj's `Geod`),
# in square metres. Coordinates must be longitude and latitude: a value
# outside their range is refused rather than read as degrees.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError
from pyproj import Geod
from shapely.geometry import shape

LOGGER = logging.getLogger(__name__)

GEOD = Geod(ellps='WGS84')
MAX_POINTS = 10_000


def _polygon_branch(type_name, coordinates):
    return {
        'required': ['type', 'coordinates'],
        'type': 'object',
        'format': 'geojson-geometry',
        'contentMediaType': 'application/geo+json',
        'properties': {
            'type': {'enum': [type_name], 'type': 'string'},
            'coordinates': coordinates
        }
    }


RING = {
    'minItems': 4,
    'type': 'array',
    'items': {'minItems': 2, 'type': 'array', 'items': {'type': 'number'}}
}

EXAMPLE_AREA = {
    'type': 'Polygon',
    'coordinates': [[
        [5.118, 52.089],
        [5.124, 52.089],
        [5.124, 52.093],
        [5.118, 52.093],
        [5.118, 52.089]
    ]]
}

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-area-what-if',
    'title': {
        'en': 'Points in an area'
    },
    'description': {
        'en': 'Counts the points of a what-if layer that fall inside an area, '
              'and measures the area. Its inputs are described as the '
              'Beleidsnormen API describes its own.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['geojson', 'feature collection', 'what-if', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'geometry': {
            'schema': {
                'example': {
                    'value': EXAMPLE_AREA,
                    'format': {'mediatype': 'application/geo+json'}
                },
                'oneOf': [
                    _polygon_branch('Polygon', {'type': 'array', 'items': RING}),
                    _polygon_branch('MultiPolygon', {
                        'type': 'array',
                        'items': {'type': 'array', 'items': RING}
                    })
                ]
            },
            'minOccurs': 1,
            'title': 'The area',
            'description': 'The area to count in (Polygon or MultiPolygon), '
                           'in longitude and latitude.',
            'maxOccurs': 1
        },
        'nieuwe_punten': {
            'schema': {
                'required': ['type', 'features'],
                'type': 'object',
                'example': {
                    'type': 'FeatureCollection',
                    'features': [{
                        'type': 'Feature',
                        'geometry': {'type': 'Point', 'coordinates': [5.121, 52.091]},
                        'properties': {}
                    }]
                },
                'properties': {
                    'type': {'enum': ['FeatureCollection'], 'type': 'string'},
                    'features': {
                        'type': 'array',
                        'items': {
                            'required': ['type', 'geometry', 'properties'],
                            'type': 'object',
                            'properties': {
                                'type': {'enum': ['Feature'], 'type': 'string'},
                                'geometry': {
                                    'oneOf': [{
                                        'required': ['type', 'coordinates'],
                                        'type': 'object',
                                        'properties': {
                                            'type': {'enum': ['Point'], 'type': 'string'},
                                            'coordinates': {
                                                'minItems': 2,
                                                'type': 'array',
                                                'items': {'type': 'number'}
                                            }
                                        }
                                    }]
                                },
                                'properties': {
                                    'type': 'object',
                                    'nullable': True,
                                    'properties': {}
                                }
                            }
                        }
                    }
                }
            },
            'minOccurs': 0,
            'title': 'nieuwe_punten',
            'description': 'New points to count: one or more FeatureCollections '
                           'of points, in longitude and latitude.',
            'maxOccurs': 'unbounded'
        }
    },
    'outputs': {
        'result': {
            'title': 'Points in the area',
            'description': 'A JSON object: "inside", how many points fall in '
                           'the area or on its edge; "points", how many were '
                           'sent; "area_m2", the geodesic area in square '
                           'metres; "points_as", how nieuwe_punten arrived '
                           '("array", "single" or "absent").',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/json'
            }
        }
    },
    'example': {
        'inputs': {
            'geometry': {'value': EXAMPLE_AREA, 'mediaType': 'application/geo+json'},
            'nieuwe_punten': [{
                'value': {
                    'type': 'FeatureCollection',
                    'features': [{
                        'type': 'Feature',
                        'geometry': {'type': 'Point', 'coordinates': [5.121, 52.091]},
                        'properties': {}
                    }]
                },
                'mediaType': 'application/geo+json'
            }]
        }
    }
}


def _unwrap(value):
    """A qualified value's `value`, or the value as it is."""

    if isinstance(value, dict) and 'value' in value and 'type' not in value:
        return value['value']
    return value


def _in_degrees(positions, name):
    for x, y, *_ in positions:
        if not (-180 <= x <= 180 and -90 <= y <= 90):
            raise ProcessorExecuteError(
                f'"{name}" must be in longitude and latitude; [{x}, {y}] is not')


def _read_area(value):
    area = _unwrap(value)
    if not isinstance(area, dict) or area.get('type') not in ('Polygon', 'MultiPolygon'):
        found = area.get('type') if isinstance(area, dict) else type(area).__name__
        raise ProcessorExecuteError(
            f'"geometry" must be a GeoJSON Polygon or MultiPolygon; received "{found}"')
    try:
        polygon = shape(area)
    except Exception as error:  # a malformed geometry, however shapely says so
        raise ProcessorExecuteError(f'"geometry" is malformed: {error}')
    rings = [polygon.exterior] if polygon.geom_type == 'Polygon' \
        else [part.exterior for part in polygon.geoms]
    for ring in rings:
        _in_degrees(ring.coords, 'geometry')
    return polygon


def _read_points(value):
    """The points of every FeatureCollection sent, and how they arrived."""

    if value is None:
        return [], 'absent'
    rows, sent_as = (value, 'array') if isinstance(value, list) else ([value], 'single')
    points = []
    for row in rows:
        collection = _unwrap(row)
        if not isinstance(collection, dict) or collection.get('type') != 'FeatureCollection':
            raise ProcessorExecuteError(
                'Each "nieuwe_punten" value must be a GeoJSON FeatureCollection')
        for feature in collection.get('features') or []:
            geometry = feature.get('geometry') if isinstance(feature, dict) else None
            if not isinstance(geometry, dict) or geometry.get('type') != 'Point':
                raise ProcessorExecuteError(
                    'Every feature of "nieuwe_punten" must be a Point')
            points.append(shape(geometry))
    if len(points) > MAX_POINTS:
        raise ProcessorExecuteError(f'At most {MAX_POINTS} points are counted')
    _in_degrees([point.coords[0] for point in points], 'nieuwe_punten')
    return points, sent_as


class AreaWhatIfProcessor(BaseProcessor):
    """Counts points in an area. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_area_what_if.AreaWhatIfProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data, outputs=None):
        area = _read_area(data.get('geometry'))
        points, sent_as = _read_points(data.get('nieuwe_punten'))
        area_m2, _ = GEOD.geometry_area_perimeter(area)
        return 'application/json', {
            'inside': sum(1 for point in points if area.covers(point)),
            'points': len(points),
            'area_m2': round(abs(area_m2), 2),
            'points_as': sent_as
        }

    def __repr__(self):
        return f'<AreaWhatIfProcessor> {self.name}'

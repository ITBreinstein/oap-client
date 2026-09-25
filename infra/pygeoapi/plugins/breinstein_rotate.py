# =================================================================
#
# A pygeoapi process with a GeoJSON polygon going in and a GeoJSON polygon
# coming out, for the oap-client contract lane and the web client's map tests.
#
# Why this exists
# ---------------
# `breinstein-inputs` takes an optional geometry but only echoes it back inside
# a JSON map, and `breinstein-bbox` returns GeoJSON but takes a box. Nothing on
# the CORS-enabled port takes a geometry and returns one. ZOO's `Buffer` does,
# but a browser cannot reach ZOO directly (finding 0050), and its descriptions
# do not say that GeoJSON is accepted.
#
# The polygon comes back rotated a quarter turn counter-clockwise, so a test
# can tell the output from the input at a glance and check it exactly. It turns
# about (cx, cy), the centre of the exterior ring's bounding box, as the shape
# looks on a map: a degree of longitude is cos(cy) times as long as a degree of
# latitude, so longitude is scaled by k = cos(cy) before the turn and back
# after it. Every position (x, y) goes to
#
#     (cx - (y - cy) / k, cy + (x - cx) * k)
#
# Without k, a shape in the Netherlands would come back stretched to more than
# twice its height on the map. It is a local approximation — right for shapes
# up to a few hundred kilometres across, not a geodesic rotation — and it is
# exact in one respect a test can rely on: rotating four times gives the input
# back.
#
# The input is declared as the OGC `geometryGeoJSON` schema's Polygon member,
# inline, with `format: "geojson-polygon"`.
#
# The standard sends an object input as a qualified value, `{ "value": <the
# polygon>, "mediaType": … }` (Requirement 20), and pygeoapi hands that wrapper
# to the process as it arrived instead of its `value` (finding 0052). So the
# process takes the polygon from `value` when the input is a qualified value,
# and takes a bare Polygon as it is. That is the server's unwrapping, done here
# because pygeoapi does not; the finding stands, and `breinstein-inputs` still
# shows the wrapper arriving. Anything else, a Feature included, is refused
# rather than unwrapped further.
#
# Deliberately not specific to any use case: it reshapes its input and does
# nothing else. See the "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging
import math

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

#: One position: two or three numbers.
POSITION_SCHEMA = {
    'type': 'array',
    'minItems': 2,
    'items': {
        'type': 'number'
    }
}

#: A closed ring: at least four positions, the last equal to the first.
RING_SCHEMA = {
    'type': 'array',
    'minItems': 4,
    'items': POSITION_SCHEMA
}

POLYGON_SCHEMA = {
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
            'items': RING_SCHEMA
        }
    }
}

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-rotate',
    'title': {
        'en': 'Rotate a polygon a quarter turn'
    },
    'description': {
        'en': 'Takes one GeoJSON polygon and returns it rotated 90 degrees '
              'counter-clockwise about the centre of its bounding box, as it '
              'looks on a map. Exists so that a geometry can go in and a '
              'different geometry come out, from a browser.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['geojson', 'polygon', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'polygon': {
            'title': 'Polygon',
            'description': 'A GeoJSON Polygon geometry, as a qualified '
                           'value or bare; not wrapped in a Feature. Holes '
                           'are rotated with it.',
            'schema': POLYGON_SCHEMA,
            'minOccurs': 1,
            'maxOccurs': 1,
            'keywords': ['geojson']
        }
    },
    'outputs': {
        'rotated': {
            'title': 'Rotated polygon',
            'description': 'The polygon rotated 90 degrees counter-clockwise, '
                           'as a GeoJSON Polygon geometry.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/geo+json'
            }
        }
    },
    'example': {
        'inputs': {
            'polygon': {
                'value': {
                    'type': 'Polygon',
                    'coordinates': [[
                        [5.0, 52.0],
                        [5.2, 52.0],
                        [5.2, 52.1],
                        [5.0, 52.1],
                        [5.0, 52.0]
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


def _read_polygon(value):
    """The rings, or a ProcessorExecuteError saying what is wrong."""

    # A qualified value: the polygon is its `value` (finding 0052).
    if isinstance(value, dict) and 'value' in value and 'type' not in value:
        value = value['value']

    if not isinstance(value, dict) or value.get('type') != 'Polygon':
        found = (value.get('type') if isinstance(value, dict)
                 else type(value).__name__)
        raise ProcessorExecuteError(
            'The "polygon" input must be a GeoJSON Polygon geometry; '
            f'received "{found}"')

    rings = value.get('coordinates')
    if not isinstance(rings, list) or len(rings) == 0:
        raise ProcessorExecuteError(
            'The "polygon" input must have at least one ring')

    for ring in rings:
        if not isinstance(ring, list) or len(ring) < 4:
            raise ProcessorExecuteError(
                'Every ring of the "polygon" input must have at least four '
                'positions')
        for position in ring:
            if (not isinstance(position, list)
                    or len(position) < 2
                    or not all(_is_number(n) for n in position)):
                raise ProcessorExecuteError(
                    'Every position of the "polygon" input must be an array '
                    'of two or more numbers')
        if ring[0] != ring[-1]:
            raise ProcessorExecuteError(
                'Every ring of the "polygon" input must end where it starts')

    return rings


def rotate_quarter_turn(rings):
    """
    The rings rotated 90 degrees counter-clockwise about the centre of the
    exterior ring's bounding box, as they look on a map. A third coordinate,
    if any, is kept as is. See the module docstring for the formula.
    """

    exterior = rings[0]
    xs = [position[0] for position in exterior]
    ys = [position[1] for position in exterior]
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2

    k = math.cos(math.radians(cy))
    if k < 0.01:
        raise ProcessorExecuteError(
            'The "polygon" input is centred too close to a pole to be turned')

    return [
        [
            [cx - (position[1] - cy) / k, cy + (position[0] - cx) * k,
             *position[2:]]
            for position in ring
        ]
        for ring in rings
    ]


class RotateProcessor(BaseProcessor):
    """Rotates a polygon a quarter turn. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_rotate.RotateProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        mimetype = 'application/geo+json'

        rings = _read_polygon(data.get('polygon'))

        rotated = {
            'type': 'Polygon',
            'coordinates': rotate_quarter_turn(rings)
        }

        return mimetype, rotated

    def __repr__(self):
        return f'<RotateProcessor> {self.name}'

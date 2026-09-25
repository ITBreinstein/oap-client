# =================================================================
#
# A pygeoapi process with one bounding-box input, for the oap-client
# contract lane and the web client's form and map tests.
#
# Why this exists
# ---------------
# The stock image's only process takes two strings, so a bounding box, the
# one spatial input shape the Task 3 census actually found (finding 0023), has
# nothing on the CORS-enabled port to be drawn, encoded or sent against. ZOO has
# bbox inputs, but a browser cannot reach ZOO (finding 0050).
#
# The input is shaped the way the census found bounding boxes: an inline
# `type: "object"` with `format: "ogc-bbox"`, a `bbox` array and a `crs` member
# declared as in the OGC `bbox.yaml` schema. Not a `$ref`.
#
# It returns the box as a GeoJSON Feature (a polygon), which also gives the
# result renderers a GeoJSON output to show.
#
# Deliberately not specific to any use case: it reshapes its input and does
# nothing else. It does not reproject, and it refuses a CRS it would have to
# reproject from. See the "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging
import math

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-bbox',
    'title': {
        'en': 'Bounding box to feature'
    },
    'description': {
        'en': 'Takes one bounding box and returns it as a GeoJSON Feature '
              'whose geometry is the box as a polygon. Exists so that a '
              'bounding-box input can be drawn, encoded and sent from a '
              'browser.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['bbox', 'echo', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'bbox': {
            'title': 'Bounding box',
            'description': 'The area to return, as minimum and maximum '
                           'longitude and latitude in CRS84.',
            'schema': {
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
                        'default': CRS84,
                        'enum': [CRS84]
                    }
                }
            },
            'minOccurs': 1,
            'maxOccurs': 1,
            'keywords': ['bbox']
        }
    },
    'outputs': {
        'feature': {
            'title': 'Feature',
            'description': 'The bounding box as a GeoJSON Feature with a '
                           'polygon geometry.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/geo+json'
            }
        }
    },
    'example': {
        'inputs': {
            'bbox': {
                'bbox': [3.0, 50.7, 7.0, 53.6],
                'crs': CRS84
            }
        }
    }
}


def _read_box(value):
    """The four coordinates, or a ProcessorExecuteError saying what is wrong."""

    if not isinstance(value, dict):
        raise ProcessorExecuteError(
            'The "bbox" input must be an object with a "bbox" member')

    crs = value.get('crs', CRS84)
    if crs != CRS84:
        raise ProcessorExecuteError(
            f'The "bbox" input must be in CRS84; received crs "{crs}"')

    box = value.get('bbox')
    if not isinstance(box, list) or len(box) != 4:
        raise ProcessorExecuteError(
            'The "bbox" member must be an array of four numbers')
    for coordinate in box:
        if (isinstance(coordinate, bool)
                or not isinstance(coordinate, (int, float))
                or not math.isfinite(coordinate)):
            raise ProcessorExecuteError(
                'The "bbox" member must be an array of four numbers')

    return [float(c) for c in box], crs


class BboxProcessor(BaseProcessor):
    """Reshapes a bounding box into a Feature. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_bbox.BboxProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        mimetype = 'application/geo+json'

        (min_x, min_y, max_x, max_y), crs = _read_box(data.get('bbox'))

        feature = {
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [[
                    [min_x, min_y],
                    [max_x, min_y],
                    [max_x, max_y],
                    [min_x, max_y],
                    [min_x, min_y]
                ]]
            },
            'properties': {
                'bbox': [min_x, min_y, max_x, max_y],
                'crs': crs
            }
        }

        return mimetype, feature

    def __repr__(self):
        return f'<BboxProcessor> {self.name}'

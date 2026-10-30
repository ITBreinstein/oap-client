# =================================================================
#
# A pygeoapi process that returns GML shaped as ZOO-Project's OGR services
# return it, for the oap-client web client's GML reading (#F4).
#
# Why this exists
# ---------------
# The only real server in the testbed that returns GML is ZOO, and a browser
# reaches it only through the relay. Its OGR services answer GML 2 style:
# an `ogr:FeatureCollection` of `gml:featureMember`s, `gml:coordinates` with
# commas, and an `srsName` that is the bare `EPSG:4326` (longitude first, as
# GML 2 writes it) or `EPSG:28992` — or, from `Centroid`, none at all. This
# process returns the same shape from the reference pygeoapi, so the blocking
# lane can test it.
#
# The `crs` input picks the variant: `EPSG:4326` (the default), `EPSG:28992`
# (the same area in RD New, so a test can check both land in the same place)
# or `none` (no `srsName`, as ZOO's `Centroid`). The area is a bounding box in
# longitude and latitude, a small box in Utrecht when left out; for RD New it
# is reprojected here with pyproj, which the image carries.
#
# Labelled `text/xml`, as ZOO's descriptions declare it; ZOO itself labels
# the answer `application/json` (finding 0026), which the web client's tests
# cover from ZOO's own captures.
#
# The data is small and fixed for a given box, and means nothing: see the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError
from pyproj import Transformer

LOGGER = logging.getLogger(__name__)

#: A small box in Utrecht, when no area is given.
DEFAULT_BBOX = [5.118, 52.089, 5.124, 52.093]

VARIANTS = ['EPSG:4326', 'EPSG:28992', 'none']

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-gml',
    'title': {
        'en': 'An area as GML, as ZOO-Project writes it'
    },
    'description': {
        'en': 'Returns the area given as one polygon feature and its centre '
              'as a point feature, in GML 2 as an OGR feature collection, '
              'with srsName EPSG:4326, EPSG:28992 or none. Exists so that a '
              'client\'s GML reading can be tested.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['gml', 'testbed'],
    'links': [],
    'inputs': {
        'area': {
            'title': 'Area',
            'description': 'A bounding box in longitude and latitude. A small '
                           'box in Utrecht when left out.',
            'schema': {
                'type': 'object',
                'format': 'ogc-bbox',
                'required': ['bbox'],
                'properties': {
                    'bbox': {
                        'type': 'array',
                        'minItems': 4,
                        'maxItems': 4,
                        'items': {'type': 'number'}
                    },
                    'crs': {
                        'type': 'string',
                        'format': 'uri',
                        'enum': [
                            'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
                        ],
                        'default':
                            'http://www.opengis.net/def/crs/OGC/1.3/CRS84'
                    }
                }
            },
            'minOccurs': 0,
            'maxOccurs': 1
        },
        'crs': {
            'title': 'srsName',
            'description': 'The srsName the GML carries: EPSG:4326, '
                           'EPSG:28992, or none.',
            'schema': {
                'type': 'string',
                'enum': VARIANTS,
                'default': 'EPSG:4326'
            },
            'minOccurs': 0,
            'maxOccurs': 1
        }
    },
    'outputs': {
        'features': {
            'title': 'Features',
            'description': 'The area and its centre, in GML 2.',
            'schema': {
                'type': 'string',
                'contentMediaType': 'text/xml',
                'contentSchema':
                    'http://schemas.opengis.net/gml/2.1.2/feature.xsd'
            }
        }
    },
    'example': {
        'inputs': {
            'area': {'bbox': DEFAULT_BBOX},
            'crs': 'EPSG:4326'
        }
    }
}


def _bbox(data):
    area = data.get('area')
    if area is None:
        return DEFAULT_BBOX
    bbox = area.get('bbox') if isinstance(area, dict) else None
    if (not isinstance(bbox, list) or len(bbox) != 4
            or not all(isinstance(n, (int, float))
                       and not isinstance(n, bool) for n in bbox)):
        raise ProcessorExecuteError(
            'The "area" input must be {"bbox": [west, south, east, north]}')
    west, south, east, north = bbox
    if west >= east or south >= north:
        raise ProcessorExecuteError(
            'The "area" input must have west < east and south < north')
    return bbox


def _positions(bbox, variant):
    """The ring and the centre, longitude first, or x, y in RD New."""

    west, south, east, north = bbox
    ring = [(west, south), (west, north), (east, north), (east, south),
            (west, south)]
    centre = ((west + east) / 2, (south + north) / 2)
    if variant != 'EPSG:28992':
        return ring, centre
    to_rd = Transformer.from_crs('OGC:CRS84', 'EPSG:28992', always_xy=True)
    return ([to_rd.transform(x, y) for x, y in ring],
            to_rd.transform(*centre))


def _number(n, variant):
    return f'{n:.3f}' if variant == 'EPSG:28992' else f'{n:.6f}'


def _gml(bbox, variant):
    ring, centre = _positions(bbox, variant)
    srs = '' if variant == 'none' else f' srsName="{variant}"'
    coordinates = ' '.join(
        f'{_number(x, variant)},{_number(y, variant)}' for x, y in ring)
    xs = [x for x, _ in ring]
    ys = [y for _, y in ring]
    return (
        '<?xml version="1.0" encoding="utf-8" ?>\n'
        '<ogr:FeatureCollection\n'
        '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
        '     xmlns:ogr="http://ogr.maptools.org/"\n'
        '     xmlns:gml="http://www.opengis.net/gml">\n'
        '  <gml:boundedBy>\n'
        '    <gml:Box>\n'
        f'      <gml:coord><gml:X>{_number(min(xs), variant)}</gml:X>'
        f'<gml:Y>{_number(min(ys), variant)}</gml:Y></gml:coord>\n'
        f'      <gml:coord><gml:X>{_number(max(xs), variant)}</gml:X>'
        f'<gml:Y>{_number(max(ys), variant)}</gml:Y></gml:coord>\n'
        '    </gml:Box>\n'
        '  </gml:boundedBy>\n'
        '  <gml:featureMember>\n'
        '    <ogr:Result fid="Result.0">\n'
        f'      <ogr:geometryProperty><gml:Polygon{srs}>'
        '<gml:outerBoundaryIs><gml:LinearRing>'
        f'<gml:coordinates>{coordinates}</gml:coordinates>'
        '</gml:LinearRing></gml:outerBoundaryIs></gml:Polygon>'
        '</ogr:geometryProperty>\n'
        '      <ogr:name>The area given</ogr:name>\n'
        '      <ogr:kind>area</ogr:kind>\n'
        '    </ogr:Result>\n'
        '  </gml:featureMember>\n'
        '  <gml:featureMember>\n'
        '    <ogr:Result fid="Result.1">\n'
        f'      <ogr:geometryProperty><gml:Point{srs}><gml:coordinates>'
        f'{_number(centre[0], variant)},{_number(centre[1], variant)}'
        '</gml:coordinates></gml:Point></ogr:geometryProperty>\n'
        '      <ogr:name>Its centre</ogr:name>\n'
        '      <ogr:kind>centre</ogr:kind>\n'
        '    </ogr:Result>\n'
        '  </gml:featureMember>\n'
        '</ogr:FeatureCollection>\n'
    )


class GmlProcessor(BaseProcessor):
    """Returns an area as GML 2. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_gml.GmlProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data, outputs=None):
        bbox = _bbox(data)
        variant = data.get('crs', 'EPSG:4326')
        if variant not in VARIANTS:
            raise ProcessorExecuteError(
                f'The "crs" input must be one of {", ".join(VARIANTS)}')
        # Bytes: pygeoapi 0.21.0 writes a job's output to a file and knows
        # how to for a dict, a list or bytes, not a str.
        return 'text/xml', _gml(bbox, variant).encode('utf-8')

    def __repr__(self):
        return f'<GmlProcessor> {self.name}'

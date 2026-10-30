# =================================================================
#
# A pygeoapi process that returns KML whose descriptions hold HTML, for the
# oap-client web client's KML reading (#F5).
#
# Why this exists
# ---------------
# ZOO returns KML for 229 outputs, but only through the relay, and its
# Placemarks carry a name and a number for a description. Real KML is often
# written by tools that put HTML in `description` — a table, a link, at worst
# a script — and data in `ExtendedData`, as `Data` pairs or as `SchemaData`
# typed by a `Schema`. A client has to show all of it as text, never as HTML.
# This process returns that, from the reference pygeoapi, for the blocking
# lane.
#
# Four Placemarks in the area given (a small box in Utrecht when left out):
# a Polygon whose description is HTML with a script and an image in it, a
# Point with `Data` pairs, a LineString with `SchemaData`, and a
# `MultiGeometry` of two points. Every coordinate has an altitude, which a
# client drops. Inside a Folder inside the Document, as tools write it.
#
# The data is small and fixed for a given box, and means nothing: see the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

KML = 'application/vnd.google-earth.kml+xml'

#: A small box in Utrecht, when no area is given.
DEFAULT_BBOX = [5.118, 52.089, 5.124, 52.093]

#: HTML, as tools write it, with what a page must never run or load.
DESCRIPTION = (
    '<![CDATA[<h3>An area</h3><p>Given as a <b>bounding box</b>.</p>'
    '<img src="https://example.org/tracker.png" onerror="alert(1)">'
    '<script>alert("not run")</script>'
    '<a href="https://example.org/">More</a>]]>'
)

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-kml',
    'title': {
        'en': 'An area as KML, with HTML in it'
    },
    'description': {
        'en': 'Returns the area given as four KML Placemarks: a polygon whose '
              'description is HTML, a point with ExtendedData Data, a line '
              'with SchemaData and a MultiGeometry. Exists so that a '
              'client\'s KML reading can be tested.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['kml', 'testbed'],
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
        }
    },
    'outputs': {
        'placemarks': {
            'title': 'Placemarks',
            'description': 'Four Placemarks in the area, in KML.',
            'schema': {
                'type': 'string',
                'contentMediaType': KML
            }
        }
    },
    'example': {
        'inputs': {
            'area': {'bbox': DEFAULT_BBOX}
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


def _xyz(points):
    return ' '.join(f'{x:.6f},{y:.6f},2.5' for x, y in points)


def _kml(bbox):
    west, south, east, north = bbox
    ring = [(west, south), (east, south), (east, north), (west, north),
            (west, south)]
    mid_x, mid_y = (west + east) / 2, (south + north) / 2
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        '<Document>\n'
        '  <name>An area</name>\n'
        '  <Schema name="measure" id="measure">\n'
        '    <SimpleField name="length" type="float"/>\n'
        '    <SimpleField name="unit" type="string"/>\n'
        '  </Schema>\n'
        '  <Folder><name>Placemarks</name>\n'
        '  <Placemark id="area">\n'
        '    <name>The area</name>\n'
        f'    <description>{DESCRIPTION}</description>\n'
        '    <Polygon><outerBoundaryIs><LinearRing>'
        f'<coordinates>{_xyz(ring)}</coordinates>'
        '</LinearRing></outerBoundaryIs></Polygon>\n'
        '  </Placemark>\n'
        '  <Placemark id="centre">\n'
        '    <name>Its centre</name>\n'
        '    <ExtendedData>\n'
        '      <Data name="kind"><value>centre</value></Data>\n'
        '      <Data name="note"><displayName>Note</displayName>'
        '<value>&lt;b&gt;not bold&lt;/b&gt;</value></Data>\n'
        '    </ExtendedData>\n'
        f'    <Point><coordinates>{_xyz([(mid_x, mid_y)])}</coordinates>'
        '</Point>\n'
        '  </Placemark>\n'
        '  <Placemark id="diagonal">\n'
        '    <name>A diagonal</name>\n'
        '    <ExtendedData><SchemaData schemaUrl="#measure">\n'
        '      <SimpleData name="length">0.0072</SimpleData>\n'
        '      <SimpleData name="unit">degree</SimpleData>\n'
        '    </SchemaData></ExtendedData>\n'
        '    <LineString><coordinates>'
        f'{_xyz([(west, south), (east, north)])}</coordinates></LineString>\n'
        '  </Placemark>\n'
        '  <Placemark id="corners">\n'
        '    <name>Two corners</name>\n'
        '    <MultiGeometry>\n'
        f'      <Point><coordinates>{_xyz([(west, north)])}</coordinates>'
        '</Point>\n'
        f'      <Point><coordinates>{_xyz([(east, south)])}</coordinates>'
        '</Point>\n'
        '    </MultiGeometry>\n'
        '  </Placemark>\n'
        '  </Folder>\n'
        '</Document>\n'
        '</kml>\n'
    )


class KmlProcessor(BaseProcessor):
    """Returns an area as KML. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_kml.KmlProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)

    def execute(self, data, outputs=None):
        # Bytes: pygeoapi 0.21.0 writes a job's output to a file and knows
        # how to for a dict, a list or bytes, not a str.
        return KML, _kml(_bbox(data)).encode('utf-8')

    def __repr__(self):
        return f'<KmlProcessor> {self.name}'

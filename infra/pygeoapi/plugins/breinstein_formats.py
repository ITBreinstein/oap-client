# =================================================================
#
# A pygeoapi process whose one output is offered in three formats, for the
# oap-client web client's choice of format (#F3).
#
# Why this exists
# ---------------
# A client that asks for an output's format has to be tested against a
# server that offers several and honours the one asked. ZOO offers several
# (its vector outputs as XML and KML) but labels every answer
# `application/json` (finding 0026), and a browser reaches it only through
# the relay. pygeoapi's own processes each offer one format.
#
# The process takes an area, as a bounding box, and returns that box as one
# polygon feature in the format asked for: GeoJSON, GML 3.2 or KML. Asked for
# none, it answers GeoJSON. A second output, the number of features, is always
# 1: it is there so that the answer for both outputs, a JSON object keyed by
# output id, is tested as well as the answer for one.
#
# When both outputs are asked for, a GML or KML `features` is a qualified
# value, `{"value": …, "mediaType": …}`, so the media type it was sent in is
# said beside it, as OGC API - Processes 1.0 has it.
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

GEOJSON = 'application/geo+json'
GML = 'application/gml+xml; version=3.2'
KML = 'application/vnd.google-earth.kml+xml'

#: A small box in Utrecht, when no area is given.
DEFAULT_BBOX = [5.118, 52.089, 5.124, 52.093]

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-formats',
    'title': {
        'en': 'An area, in a format of your choice'
    },
    'description': {
        'en': 'Returns the area given as one polygon feature, as GeoJSON, '
              'GML 3.2 or KML, whichever is asked for. Exists so that a '
              'client\'s choice of an output format can be tested.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['formats', 'geojson', 'gml', 'kml', 'testbed'],
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
        'features': {
            'title': 'Features',
            'description': 'The area as one polygon feature.',
            'schema': {
                'oneOf': [
                    {'type': 'object', 'contentMediaType': GEOJSON},
                    {
                        'type': 'string',
                        'contentMediaType': GML,
                        'contentSchema':
                            'http://schemas.opengis.net/gml/3.2.1/gml.xsd'
                    },
                    {'type': 'string', 'contentMediaType': KML}
                ]
            }
        },
        'count': {
            'title': 'Count',
            'description': 'The number of features: always 1.',
            'schema': {'type': 'integer'}
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


def _ring(bbox):
    west, south, east, north = bbox
    return [[west, south], [east, south], [east, north], [west, north],
            [west, south]]


def _geojson(bbox):
    return {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'id': 'area',
            'properties': {'name': 'The area given'},
            'geometry': {'type': 'Polygon', 'coordinates': [_ring(bbox)]}
        }]
    }


def _gml(bbox):
    # CRS84 in its URI form: longitude first, as the URI says.
    positions = ' '.join(f'{x} {y}' for x, y in _ring(bbox))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<wfs:FeatureCollection'
        ' xmlns:wfs="http://www.opengis.net/wfs/2.0"'
        ' xmlns:gml="http://www.opengis.net/gml/3.2"'
        ' xmlns:b="https://example.org/breinstein">'
        '<wfs:member><b:area gml:id="area">'
        '<b:name>The area given</b:name>'
        '<b:geometry>'
        '<gml:Polygon gml:id="area.geom"'
        ' srsName="http://www.opengis.net/def/crs/OGC/1.3/CRS84">'
        '<gml:exterior><gml:LinearRing>'
        f'<gml:posList>{positions}</gml:posList>'
        '</gml:LinearRing></gml:exterior></gml:Polygon>'
        '</b:geometry></b:area></wfs:member></wfs:FeatureCollection>\n'
    )


def _kml(bbox):
    coordinates = ' '.join(f'{x},{y}' for x, y in _ring(bbox))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        '<Placemark><name>The area given</name>'
        '<Polygon><outerBoundaryIs><LinearRing>'
        f'<coordinates>{coordinates}</coordinates>'
        '</LinearRing></outerBoundaryIs></Polygon>'
        '</Placemark></Document></kml>\n'
    )


def _asked(outputs):
    """The media type asked for `features`, or GeoJSON when none was."""

    selection = (outputs or {}).get('features') or {}
    fmt = selection.get('format') if isinstance(selection, dict) else None
    media_type = fmt.get('mediaType') if isinstance(fmt, dict) else None
    if media_type is None:
        return GEOJSON
    for offered in (GEOJSON, GML, KML):
        if media_type.split(';')[0].strip().lower() == \
                offered.split(';')[0].strip().lower():
            return offered
    raise ProcessorExecuteError(
        f'The "features" output is offered as {GEOJSON}, {GML} or {KML}, '
        f'not {media_type}')


class FormatsProcessor(BaseProcessor):
    """Returns an area in the format asked. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_formats.FormatsProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        bbox = _bbox(data)
        media_type = _asked(outputs)
        if media_type == GEOJSON:
            features = _geojson(bbox)
        elif media_type == GML:
            features = _gml(bbox)
        else:
            features = _kml(bbox)

        wanted = list(outputs) if outputs else ['features', 'count']
        if wanted == ['features']:
            if media_type == GEOJSON:
                return GEOJSON, features
            # Bytes: pygeoapi 0.21.0 writes a job's output to a file and
            # knows how to for a dict, a list or bytes, not a str.
            return media_type, features.encode('utf-8')
        if wanted == ['count']:
            return 'application/json', {'count': 1}

        value = features if media_type == GEOJSON \
            else {'value': features, 'mediaType': media_type}
        return 'application/json', {'features': value, 'count': 1}

    def __repr__(self):
        return f'<FormatsProcessor> {self.name}'


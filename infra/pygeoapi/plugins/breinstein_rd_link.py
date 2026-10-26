# =================================================================
#
# A pygeoapi process whose one output is a link to a features collection on
# this same server, served in RD New (EPSG:28992), for the oap-client web
# client's reprojection of what it can name (#F1).
#
# Why this exists
# ---------------
# A client that reprojects GeoJSON by its `Content-Crs` header has to be
# tested against a server that sends one. A pygeoapi process cannot: it
# returns a media type and a body, and no headers. pygeoapi's own OGC API -
# Features can: a collection stored in EPSG:28992 and asked for with
# `crs=…/EPSG/0/28992` is answered as stored, with
# `Content-Crs: <http://www.opengis.net/def/crs/EPSG/0/28992>`.
#
# So this process returns a link to that query, as `breinstein-buildings`
# returns a link to PDOK's: the client follows it, reads the header, and
# reprojects. The collection is `breinstein-rd`, three small fixed features in
# Utrecht (infra/pygeoapi/data/breinstein-rd.geojson). Everything is served
# locally: the blocking lane does not depend on the network.
#
# The one input, `crs`, says which coordinate system the link asks for:
# RD New by default, or CRS84, which pygeoapi reprojects itself. The same
# features in both are what a test compares.
#
# The collection's address is set per instance in the YAML, as `target` under
# `processor`, as `breinstein-link` does; nothing here computes it.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging
import urllib.parse

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

RD_NEW = 'http://www.opengis.net/def/crs/EPSG/0/28992'
CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-rd-link',
    'title': {
        'en': 'Areas in RD New, by reference'
    },
    'description': {
        'en': 'Returns one output by reference: a link to three fixed '
              'features on this server, in RD New (EPSG:28992) or in CRS84, '
              'whichever is asked for. The features API sends Content-Crs.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'outputTransmission': ['reference'],
    'keywords': ['reference', 'crs', 'rd-new', 'testbed'],
    'links': [],
    'inputs': {
        'crs': {
            'title': 'Coordinate system',
            'description': 'The coordinate system the link asks for. RD New '
                           'when left out.',
            'schema': {
                'type': 'string',
                'enum': [RD_NEW, CRS84],
                'default': RD_NEW
            },
            'minOccurs': 0,
            'maxOccurs': 1
        }
    },
    'outputs': {
        'areas': {
            'title': 'Areas',
            'description': 'A link to the features, in the coordinate system '
                           'asked for. Always by reference.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/geo+json'
            }
        }
    },
    'example': {
        'inputs': {
            'crs': RD_NEW
        }
    }
}


class RdLinkProcessor(BaseProcessor):
    """Returns a link to features in RD New. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition, carrying `target`

        :returns: breinstein_rd_link.RdLinkProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.target = processor_def.get('target')
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        if not self.target:
            raise ProcessorExecuteError(
                'This server has no collection configured for this process')
        crs = data.get('crs', RD_NEW)
        if crs not in (RD_NEW, CRS84):
            raise ProcessorExecuteError(
                f'The "crs" input must be {RD_NEW} or {CRS84}, not {crs}')
        href = self.target + '?' + urllib.parse.urlencode(
            {'f': 'json', 'crs': crs})
        link = {
            'href': href,
            'rel': 'related',
            'type': 'application/geo+json',
            'title': 'Three areas in Utrecht'
        }
        return 'application/json', {'areas': link}

    def __repr__(self):
        return f'<RdLinkProcessor> {self.name}'

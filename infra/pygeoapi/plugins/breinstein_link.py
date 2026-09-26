# =================================================================
#
# A pygeoapi process whose one output is always a link, to a file on the
# *other* pygeoapi instance, for the oap-client web client's handling of
# outputs given by reference.
#
# Why this exists
# ---------------
# A web page may fetch what a reference points at only when that server sends
# CORS headers, and the client has to show and record the case where it does
# not. No server under test can be made to produce that on demand in CI:
# pygeoapi :5080 grants every preflight (finding 0057), PDOK sends CORS
# headers, and ZOO, whose references are all unreadable from a page, is not in
# the blocking lane. The two pygeoapi instances already differ in exactly that
# one respect, and both serve their own static files, so this process links
# from one to the other:
#
# - on :5080, to :5081's logo: an origin with no CORS headers, so the page
#   cannot read it and must say so;
# - on :5081, to :5080's logo: an origin that grants it, so the page can.
#
# The target is set per instance in the YAML, as `target` and `type` under
# `processor`, and nothing here computes it. The process takes no inputs and
# fetches nothing.
#
# It returns the link whether or not it was asked for one, and declares
# `outputTransmission: ["reference"]`. pygeoapi describes it as `["value"]`
# regardless (finding 0059).
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-link',
    'title': {
        'en': 'A link to a file on another server'
    },
    'description': {
        'en': 'Takes nothing and returns one output by reference: a link to '
              'a static file on another server, set in this server\'s '
              'configuration.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'outputTransmission': ['reference'],
    'keywords': ['reference', 'cors', 'testbed'],
    'links': [],
    'inputs': {},
    'outputs': {
        'file': {
            'title': 'File',
            'description': 'A link to the configured file. Always by '
                           'reference.',
            'schema': {
                'type': 'string',
                'contentMediaType': 'image/png',
                'contentEncoding': 'binary'
            }
        }
    },
    'example': {
        'inputs': {}
    }
}


class LinkProcessor(BaseProcessor):
    """Returns a link. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition, carrying `target` and
                              `type`

        :returns: breinstein_link.LinkProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.target = processor_def.get('target')
        self.type = processor_def.get('type')
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        if not self.target:
            raise ProcessorExecuteError(
                'This server has no link target configured for this process')
        link = {
            'href': self.target,
            'rel': 'related',
            'title': 'A file on another server'
        }
        if self.type:
            link['type'] = self.type
        return 'application/json', {'file': link}

    def __repr__(self):
        return f'<LinkProcessor> {self.name}'

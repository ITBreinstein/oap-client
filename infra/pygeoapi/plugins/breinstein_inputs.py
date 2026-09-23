# =================================================================
#
# A pygeoapi process with one input of every kind the web client's form
# generator renders, and two outputs, for the oap-client contract lane and the
# web client's form tests.
#
# Why this exists
# ---------------
# The stock image's only process has two string inputs and one output. A form
# generator tested against it has never met a number, a bound, an enum, a
# boolean, a repeatable input or a second output, and every one of those
# changes what goes on the wire.
#
# It echoes the inputs it received, verbatim, as its first output. That is
# the point: a browser test can fill in the form and assert on exactly what
# arrived at the server, rather than on what the client believes it sent.
#
# It does **no validation of its own**. Whether a wrong-typed or out-of-range
# value is refused is then pygeoapi's decision alone, which is what the web
# client's validation question (Task 7, Z5) needs to measure.
#
# The multi-line string is declared as `type: "string"` with
# `contentMediaType: "text/plain"`: JSON Schema has no "multi-line" keyword,
# and a string whose content is a plain-text document is the nearest thing the
# standard vocabulary has.
#
# Deliberately not specific to any use case: it echoes and summarises. See the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import json
import logging

from pygeoapi.process.base import BaseProcessor

LOGGER = logging.getLogger(__name__)

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-inputs',
    'title': {
        'en': 'Every input kind'
    },
    'description': {
        'en': 'Takes one input of every kind a generated form renders and '
              'returns them unchanged, plus a plain-text summary. Exists so '
              'that a form can be tested against exactly what the server '
              'received.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['echo', 'inputs', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'label': {
            'title': 'Label',
            'description': 'A short string of at most 20 characters.',
            'schema': {
                'type': 'string',
                'maxLength': 20
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'notes': {
            'title': 'Notes',
            'description': 'Free text; may span several lines.',
            'schema': {
                'type': 'string',
                'contentMediaType': 'text/plain'
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'count': {
            'title': 'Count',
            'description': 'A whole number from 1 to 10.',
            'schema': {
                'type': 'integer',
                'minimum': 1,
                'maximum': 10
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'ratio': {
            'title': 'Ratio',
            'description': 'Any number; 0.5 unless changed.',
            'schema': {
                'type': 'number',
                'default': 0.5
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'colour': {
            'title': 'Colour',
            'description': 'One of three values.',
            'schema': {
                'type': 'string',
                'enum': ['red', 'green', 'blue']
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'enabled': {
            'title': 'Enabled',
            'description': 'Yes or no.',
            'schema': {
                'type': 'boolean'
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'tags': {
            'title': 'Tags',
            'description': 'Up to three short strings.',
            'schema': {
                'type': 'string'
            },
            'minOccurs': 1,
            'maxOccurs': 3
        },
        'comment': {
            'title': 'Comment',
            'description': 'Optional; left out of the request when empty.',
            'schema': {
                'type': 'string'
            },
            'minOccurs': 0,
            'maxOccurs': 1
        }
    },
    'outputs': {
        'echo': {
            'title': 'Received inputs',
            'description': 'The inputs exactly as the server received them.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/json'
            }
        },
        'summary': {
            'title': 'Summary',
            'description': 'One line per input received, as plain text.',
            'schema': {
                'type': 'string',
                'contentMediaType': 'text/plain'
            }
        }
    },
    'example': {
        'inputs': {
            'label': 'example',
            'notes': 'first line\nsecond line',
            'count': 3,
            'ratio': 0.5,
            'colour': 'green',
            'enabled': True,
            'tags': ['a', 'b']
        }
    }
}


def _summarise(data):
    lines = [f'{key}: {json.dumps(data[key])}' for key in sorted(data)]
    return '\n'.join(lines) + '\n'


class InputsProcessor(BaseProcessor):
    """Echoes every input it received. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_inputs.InputsProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        wanted = set(outputs) if bool(outputs) else {'echo', 'summary'}

        # One output asked for on its own is returned raw, in its own media
        # type, as OGC 18-062r2 describes for a single raw output. Both
        # together are a JSON results map keyed by output id, because a
        # pygeoapi processor returns one media type and one payload.
        if wanted == {'summary'}:
            return 'text/plain', _summarise(data).encode('utf-8')

        produced = {}
        if 'echo' in wanted:
            produced['echo'] = data
        if 'summary' in wanted:
            produced['summary'] = _summarise(data)
        return 'application/json', produced

    def __repr__(self):
        return f'<InputsProcessor> {self.name}'

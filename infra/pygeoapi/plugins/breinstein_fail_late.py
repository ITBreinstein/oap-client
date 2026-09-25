# =================================================================
#
# A pygeoapi process that runs for a while and then fails, for the
# oap-client contract lane and the web client's failed-job display.
#
# Why this exists
# ---------------
# Every other process here either succeeds or refuses its inputs before it
# starts, which in a background run means a job that is `failed` before the
# first poll. A job that is seen `accepted` first and `failed` afterwards —
# the way a real computation fails, out of memory or on bad data halfway —
# had nothing to come from. This one sleeps for `seconds`, then raises with
# `message`, so a client can be watched going from a running job to a failed
# one, and showing why.
#
# Deliberately not specific to any use case: it sleeps and fails. See the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging
import time

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

MAX_SECONDS = 60

DEFAULT_MESSAGE = 'Failed on purpose, after running for a while.'

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-fail-late',
    'title': {
        'en': 'Process that fails after a while'
    },
    'description': {
        'en': 'Runs for a number of seconds and then fails with a message, '
              'so a client can be watched going from a running job to a '
              'failed one. It never succeeds.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['failure', 'async', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'seconds': {
            'title': 'Seconds',
            'description': 'How long to run before failing, 0 to '
                           f'{MAX_SECONDS}.',
            'schema': {
                'type': 'number',
                'minimum': 0,
                'maximum': MAX_SECONDS,
                'default': 3
            },
            'minOccurs': 0,
            'maxOccurs': 1
        },
        'message': {
            'title': 'Message',
            'description': 'What the failure says.',
            'schema': {
                'type': 'string',
                'default': DEFAULT_MESSAGE
            },
            'minOccurs': 0,
            'maxOccurs': 1
        }
    },
    'outputs': {
        'never': {
            'title': 'Never produced',
            'description': 'The process always fails; this output exists '
                           'because a description needs one.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/json'
            }
        }
    },
    'example': {
        'inputs': {
            'seconds': 3,
            'message': 'Out of coffee'
        }
    }
}


class FailLateProcessor(BaseProcessor):
    """Sleeps, then fails. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_fail_late.FailLateProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        seconds = data.get('seconds', 3)
        if (isinstance(seconds, bool) or not isinstance(seconds, (int, float))
                or seconds < 0 or seconds > MAX_SECONDS):
            raise ProcessorExecuteError(
                f'The "seconds" input must be a number from 0 to {MAX_SECONDS}')
        message = data.get('message', DEFAULT_MESSAGE)
        if not isinstance(message, str) or message.strip() == '':
            message = DEFAULT_MESSAGE

        remaining = float(seconds)
        while remaining > 0:
            step = min(1.0, remaining)
            time.sleep(step)
            remaining -= step

        raise ProcessorExecuteError(message)

    def __repr__(self):
        return f'<FailLateProcessor> {self.name}'

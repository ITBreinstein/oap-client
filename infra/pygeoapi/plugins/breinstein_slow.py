# =================================================================
#
# A deliberately slow pygeoapi process, for the oap-client contract lane.
#
# Why this exists
# ---------------
# The pinned pygeoapi registers one process, `hello-world`, which completes
# instantly. Against it every job is `successful` before the first poll
# returns, so the whole asynchronous surface is untestable: a `running` job is
# never observed, `Retry-After` is never exercised, cancellation mid-poll
# cannot be tested, `DELETE` on a *running* job cannot be told apart from
# `DELETE` on a finished one, and the progress-reporting path has no data.
#
# ZOO-Project's `longProcess` gives a second opinion, but the interop lane
# never blocks a release, so it cannot be the deterministic lane.
#
# This is the first of the four coverage-gap processes on the backlog; the
# others are non-JSON output, multiple outputs, and a bbox input.
#
# Deliberately not specific to any use case: it sleeps and echoes, so that
# nothing in the client can ever be tuned to what it computes. See the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging
import time

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

#: Upper bound on `seconds`, so a stray request cannot pin a worker forever.
MAX_SECONDS = 600

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'slow',
    'title': {
        'en': 'Slow process'
    },
    'description': {
        'en': 'Sleeps for a configurable number of seconds and then returns a '
              'small JSON output. Exists so that asynchronous execution, job '
              'polling, progress reporting and dismissal can be observed '
              'against a job that is still running.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['slow', 'sleep', 'async', 'testbed'],
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
            'description': 'How long to sleep before producing the output. '
                           f'Clamped to the range 0..{MAX_SECONDS}.',
            'schema': {
                'type': 'number',
                'minimum': 0,
                'maximum': MAX_SECONDS,
                'default': 5
            },
            'minOccurs': 0,
            'maxOccurs': 1,
            'keywords': ['duration']
        },
        'message': {
            'title': 'Message',
            'description': 'An optional string echoed back in the output.',
            'schema': {
                'type': 'string'
            },
            'minOccurs': 0,
            'maxOccurs': 1,
            'keywords': ['message']
        }
    },
    'outputs': {
        'slept': {
            'title': 'Slept',
            'description': 'How long the process actually slept, and the '
                           'echoed message.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/json'
            }
        }
    },
    'example': {
        'inputs': {
            'seconds': 20,
            'message': 'polling test'
        }
    }
}


class SlowProcessor(BaseProcessor):
    """Sleeps, then echoes. See the module docstring for why."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_slow.SlowProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        mimetype = 'application/json'

        requested = data.get('seconds', 5)
        if isinstance(requested, bool) or not isinstance(requested, (int, float)):
            raise ProcessorExecuteError(
                'The "seconds" input must be a number')
        if requested < 0:
            raise ProcessorExecuteError(
                'The "seconds" input must not be negative')

        seconds = min(float(requested), float(MAX_SECONDS))
        message = data.get('message', '')

        # Slept in short slices rather than one long sleep: it keeps the
        # container responsive to a stop signal, and it is where a progress
        # callback would go if pygeoapi's BaseProcessor had one to call.
        LOGGER.debug(f'slow: sleeping for {seconds} seconds')
        remaining = seconds
        while remaining > 0:
            slice_length = min(1.0, remaining)
            time.sleep(slice_length)
            remaining -= slice_length

        produced_outputs = {}
        if not bool(outputs) or 'slept' in outputs:
            produced_outputs = {
                'id': 'slept',
                'value': {
                    'seconds': seconds,
                    'message': message
                }
            }

        return mimetype, produced_outputs

    def __repr__(self):
        return f'<SlowProcessor> {self.name}'

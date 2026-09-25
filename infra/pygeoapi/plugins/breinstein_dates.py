# =================================================================
#
# A pygeoapi process with a date input and a date-time input, for the
# oap-client web client's form generation.
#
# Why this exists
# ---------------
# JSON Schema says what a date is with `format`: `"date"` for 2026-09-25 and
# `"date-time"` for an RFC 3339 instant with its offset. Time filters are
# common on Dutch data — imagery by acquisition date, features by validity —
# but nothing on the pinned pygeoapi declares either, so what the generated
# form does with them had never been seen. This one declares both and says
# back what it understood: the date and its weekday and ISO week, the instant
# in UTC and the offset it was given with.
#
# It checks the formats itself, because pygeoapi validates nothing against
# the description (finding 0054): a value that is not a date is refused here
# with a message, rather than read as whatever Python would make of it.
#
# Deliberately not specific to any use case: it parses and echoes. See the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import datetime
import logging

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-dates',
    'title': {
        'en': 'Dates and times'
    },
    'description': {
        'en': 'Takes a date and, optionally, an instant, and says back what '
              'it understood: the weekday and ISO week of the date, and the '
              'instant in UTC with the offset it was given.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['date', 'time', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'day': {
            'title': 'Day',
            'description': 'A calendar date, as YYYY-MM-DD.',
            'schema': {
                'type': 'string',
                'format': 'date'
            },
            'minOccurs': 1,
            'maxOccurs': 1
        },
        'moment': {
            'title': 'Moment',
            'description': 'Optional; an instant with its offset, as RFC 3339 '
                           '(2026-09-25T14:30:00+02:00).',
            'schema': {
                'type': 'string',
                'format': 'date-time'
            },
            'minOccurs': 0,
            'maxOccurs': 1
        }
    },
    'outputs': {
        'understood': {
            'title': 'Understood',
            'description': 'The date and instant as the process read them.',
            'schema': {
                'type': 'object',
                'contentMediaType': 'application/json'
            }
        }
    },
    'example': {
        'inputs': {
            'day': '2026-11-03',
            'moment': '2026-11-03T09:00:00+01:00'
        }
    }
}


def _day(value):
    if not isinstance(value, str):
        raise ProcessorExecuteError('The "day" input must be a string')
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise ProcessorExecuteError(
            f'The "day" input must be a date as YYYY-MM-DD; received "{value}"')


def _moment(value):
    if not isinstance(value, str):
        raise ProcessorExecuteError('The "moment" input must be a string')
    # RFC 3339 requires the offset; Python would read a time without one as
    # local to wherever the server runs, which is not what was meant.
    try:
        parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        parsed = None
    if parsed is None or 'T' not in value.upper() or parsed.tzinfo is None:
        raise ProcessorExecuteError(
            'The "moment" input must be an RFC 3339 date-time with an offset, '
            f'such as 2026-09-25T14:30:00+02:00; received "{value}"')
    return parsed


class DatesProcessor(BaseProcessor):
    """Reads a date and an instant. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_dates.DatesProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        day = _day(data.get('day'))
        year, week, _ = day.isocalendar()
        understood = {
            'day': {
                'received': data.get('day'),
                'date': day.isoformat(),
                'weekday': day.strftime('%A'),
                'isoWeek': f'{year}-W{week:02d}'
            }
        }

        if 'moment' in data:
            moment = _moment(data.get('moment'))
            offset = moment.utcoffset()
            minutes = int(offset.total_seconds() // 60)
            sign = '+' if minutes >= 0 else '-'
            understood['moment'] = {
                'received': data.get('moment'),
                'utc': moment.astimezone(datetime.timezone.utc)
                             .isoformat().replace('+00:00', 'Z'),
                'offset': f'{sign}{abs(minutes) // 60:02d}:'
                          f'{abs(minutes) % 60:02d}'
            }

        # One output: returned as itself, not in a results map.
        return 'application/json', understood

    def __repr__(self):
        return f'<DatesProcessor> {self.name}'

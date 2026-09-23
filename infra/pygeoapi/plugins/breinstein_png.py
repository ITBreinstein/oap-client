# =================================================================
#
# A pygeoapi process whose output is a PNG, for the oap-client contract lane
# and the web client's result handling.
#
# Why this exists
# ---------------
# Every output the stock image can produce is JSON, so a client tested against
# it has never had to decide what to do with bytes it cannot show as text. ZOO
# produces non-JSON outputs, but labels them `application/json` (finding 0026)
# and a browser cannot reach it (finding 0050).
#
# The image is a grey gradient of the requested size, built with the standard
# library alone (zlib and struct) so the pinned image needs no extra package.
#
# Deliberately not specific to any use case: the picture means nothing. See the
# "no use case of our own" rule in the agent notes.
#
# MIT, same as the rest of the repository.
#
# =================================================================

import logging
import struct
import zlib

from pygeoapi.process.base import BaseProcessor, ProcessorExecuteError

LOGGER = logging.getLogger(__name__)

#: Bounds on `size`, so a stray request cannot allocate a huge image.
MIN_SIZE = 1
MAX_SIZE = 256

#: Process metadata and description
PROCESS_METADATA = {
    'version': '1.0.0',
    'id': 'breinstein-png',
    'title': {
        'en': 'Generated PNG'
    },
    'description': {
        'en': 'Returns a small square PNG image of the requested size. Exists '
              'so that a non-JSON output can be downloaded or shown.'
    },
    'jobControlOptions': ['sync-execute', 'async-execute'],
    'keywords': ['png', 'image', 'testbed'],
    'links': [{
        'type': 'text/html',
        'rel': 'about',
        'title': 'information',
        'href': 'https://example.org/process',
        'hreflang': 'en-US'
    }],
    'inputs': {
        'size': {
            'title': 'Size',
            'description': 'Width and height of the image in pixels, from '
                           f'{MIN_SIZE} to {MAX_SIZE}.',
            'schema': {
                'type': 'integer',
                'minimum': MIN_SIZE,
                'maximum': MAX_SIZE,
                'default': 16
            },
            'minOccurs': 0,
            'maxOccurs': 1
        }
    },
    'outputs': {
        'image': {
            'title': 'Image',
            'description': 'A square grey-gradient PNG.',
            'schema': {
                'type': 'string',
                'contentEncoding': 'binary',
                'contentMediaType': 'image/png'
            }
        }
    },
    'example': {
        'inputs': {
            'size': 16
        }
    }
}


def _chunk(kind, payload):
    body = kind + payload
    return (struct.pack('>I', len(payload)) + body
            + struct.pack('>I', zlib.crc32(body) & 0xffffffff))


def _png(size):
    """An 8-bit greyscale PNG, darker at the top left, lighter at bottom right."""

    rows = bytearray()
    span = max(1, 2 * (size - 1))
    for y in range(size):
        rows.append(0)  # filter type: none
        for x in range(size):
            rows.append((255 * (x + y)) // span)

    header = struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + _chunk(b'IHDR', header)
            + _chunk(b'IDAT', zlib.compress(bytes(rows)))
            + _chunk(b'IEND', b''))


class PngProcessor(BaseProcessor):
    """Returns a generated PNG. See the module docstring."""

    def __init__(self, processor_def):
        """
        Initialize object

        :param processor_def: provider definition

        :returns: breinstein_png.PngProcessor
        """

        super().__init__(processor_def, PROCESS_METADATA)
        self.supports_outputs = True

    def execute(self, data, outputs=None):
        size = data.get('size', 16)
        if isinstance(size, bool) or not isinstance(size, int):
            raise ProcessorExecuteError('The "size" input must be an integer')
        if size < MIN_SIZE or size > MAX_SIZE:
            raise ProcessorExecuteError(
                f'The "size" input must be from {MIN_SIZE} to {MAX_SIZE}')

        return 'image/png', _png(size)

    def __repr__(self):
        return f'<PngProcessor> {self.name}'

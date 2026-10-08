"""Writes the point cloud `execute.request.json` sends, as base64, to stdout.

A LAS 1.2 file, point data format 0, no variable-length records: nine points
on a 2 m grid, heights 1 to 9 m. Made up for this test; it describes no place.

    python3 make-las.py
"""

import base64
import struct
import sys

SCALE = (0.01, 0.01, 0.01)
OFFSET = (0.0, 0.0, 0.0)
POINTS = [(x, y, 1.0 + 3 * row + col)
          for row, y in enumerate((0.0, 2.0, 4.0))
          for col, x in enumerate((0.0, 2.0, 4.0))]


def header(count):
    xs, ys, zs = zip(*POINTS)
    return b"".join([
        b"LASF",
        struct.pack("<HH", 0, 0),           # file source id, global encoding
        bytes(16),                          # project GUID
        struct.pack("<BB", 1, 2),           # version 1.2
        b"oap-client".ljust(32, b"\0"),     # system identifier
        b"make-las.py".ljust(32, b"\0"),    # generating software
        struct.pack("<HH", 1, 2026),        # creation day of year, year
        struct.pack("<HII", 227, 227, 0),   # header size, point offset, VLRs
        struct.pack("<BHI", 0, 20, count),  # point format, record length, count
        struct.pack("<5I", count, 0, 0, 0, 0),
        struct.pack("<3d", *SCALE),
        struct.pack("<3d", *OFFSET),
        struct.pack("<6d", max(xs), min(xs), max(ys), min(ys), max(zs), min(zs)),
    ])


def record(x, y, z):
    ints = [round((v - o) / s) for v, o, s in zip((x, y, z), OFFSET, SCALE)]
    # intensity 0; return 1 of 1; class 2 (ground); scan angle, user data and
    # point source id 0.
    return struct.pack("<3iHBBbBH", *ints, 0, 0b00001001, 2, 0, 0, 0)


data = header(len(POINTS)) + b"".join(record(*p) for p in POINTS)
assert len(data) == 227 + 20 * len(POINTS)
sys.stdout.write(base64.b64encode(data).decode("ascii"))

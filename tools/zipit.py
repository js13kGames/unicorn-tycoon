#!/usr/bin/env python3
"""Assemble a ZIP container manually using zopfli deflate.

Compared with `zip -9`, zopfli explores more block splits while producing a
compatible deflate stream. It saved 368 bytes in a previous project build.
Python's zipfile module cannot use it directly, so assemble the three ZIP
records manually.

Usage: zipit.py <page.html> <output.zip> [limit]
"""
import sys, zlib, struct, os
import zopfli.zlib as zz

LIMIT = 13312          # js13kGames limit: 13 * 1024 bytes
NAME = b'index.html'   # required entry filename


def build(data: bytes, name: bytes = NAME, iterations: int = 15000) -> bytes:
    # ZIP needs raw deflate, so remove the zlib header (2 bytes)
    # and trailing Adler-32 checksum (4 bytes) from zopfli.zlib's output.
    comp = zz.compress(data, numiterations=iterations)[2:-4]
    crc = zlib.crc32(data) & 0xffffffff
    local = struct.pack('<IHHHHHIIIHH',
                        0x04034b50, 20, 0, 8, 0, 0,
                        crc, len(comp), len(data), len(name), 0) + name
    central = struct.pack('<IHHHHHHIIIHHHHHII',
                          0x02014b50, 20, 20, 0, 8, 0, 0,
                          crc, len(comp), len(data), len(name),
                          0, 0, 0, 0, 0, 0) + name
    end = struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, 1, 1,
                      len(central), len(local) + len(comp), 0)
    return local + comp + central + end


if __name__ == '__main__':
    page = open(sys.argv[1], 'rb').read()
    out = sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else LIMIT
    blob = build(page)
    n = len(blob)
    room = limit - n
    print('ZIP %d / %d  %s' % (n, limit,
          'under the limit, %d bytes remaining' % room if room >= 0 else 'OVER LIMIT by %d bytes' % -room))
    if room < 0:
        sys.exit(1)  # Never replace the last valid release with an oversized ZIP.
    open(out + '.tmp', 'wb').write(blob)
    os.replace(out + '.tmp', out)

#!/usr/bin/env python3
"""Build-only WOFF1 -> sfnt conversion of the pinned, trusted Noto Sans package.

This script is never an operation exposed by the document worker. Both paths are
selected by the build, and the fixed subset filenames cannot be request input.
"""
from pathlib import Path
import struct
import sys
import zlib

SUBSETS = ('latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese', 'devanagari')


def convert(raw):
    if len(raw) < 44 or len(raw) > 4 * 1024 * 1024:
        raise ValueError('Invalid bundled WOFF font size')
    signature, flavor, length, count, reserved, total_size = struct.unpack_from('>4s4sIHHI', raw)
    if signature != b'wOFF' or flavor != b'\x00\x01\x00\x00' or length != len(raw) or not 1 <= count <= 100 or reserved:
        raise ValueError('Invalid bundled WOFF1 font')
    selector = count.bit_length() - 1
    output = bytearray(struct.pack('>4sHHHH', flavor, count, 16 * 2 ** selector, selector, count * 16 - 16 * 2 ** selector))
    output.extend(b'\0' * (count * 16))
    head_offset = None
    seen = set()
    for index in range(count):
        tag, offset, compressed, original, checksum = struct.unpack_from('>4sIIII', raw, 44 + index * 20)
        if tag in seen or offset + compressed > len(raw) or original > 4 * 1024 * 1024 or compressed > original:
            raise ValueError('Invalid bundled WOFF table')
        seen.add(tag)
        data = raw[offset:offset + compressed]
        if compressed < original:
            inflater = zlib.decompressobj()
            data = inflater.decompress(data, original + 1)
            if not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
                raise ValueError('Invalid bundled WOFF compression')
        if len(data) != original:
            raise ValueError('Invalid bundled WOFF table length')
        table_offset = len(output)
        struct.pack_into('>4sIII', output, 12 + index * 16, tag, checksum, table_offset, original)
        output.extend(data); output.extend(b'\0' * (-len(output) % 4))
        if tag == b'head':
            head_offset = table_offset
    if len(output) != total_size or head_offset is None:
        raise ValueError('Invalid bundled font output')
    struct.pack_into('>I', output, head_offset + 8, 0)
    checksum = sum(struct.unpack('>' + 'I' * (len(output) // 4), output)) & 0xFFFFFFFF
    struct.pack_into('>I', output, head_offset + 8, (0xB1B0AFBA - checksum) & 0xFFFFFFFF)
    return output


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: prepare-fonts.py TRUSTED_FONTSOURCE_DIR OUTPUT_DIR')
    source, target = map(Path, sys.argv[1:]); target.mkdir(parents=True, exist_ok=True)
    for subset in SUBSETS:
        name = 'noto-sans-' + subset + '-400-normal'
        (target / (name + '.ttf')).write_bytes(convert((source / (name + '.woff')).read_bytes()))


if __name__ == '__main__':
    main()

"""Development worker. OS confinement lives in the native helper, not Python.

Every byte produced by this process (including this JSON envelope) is untrusted.
The host must validate results again before storing or previewing artifacts.
"""
import base64
import contextlib
import io
import json
import os
import resource
from pathlib import Path
import stat
import sys
import time
import traceback

FILE_LIMIT = 4 * 1024 * 1024
TOTAL_LIMIT = 8 * 1024 * 1024
INPUT_LIMIT = 10 * 1024 * 1024
MIMES = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}


def plain_text(value, limit):
    if not isinstance(value, str) or '\0' in value:
        return False
    try:
        return len(value.encode('utf-8')) <= limit
    except UnicodeError:
        return False


def validate_request(request):
    if not isinstance(request, dict) or set(request) != {'code', 'files'}:
        raise ValueError('Provide code and staged files only.')
    if not plain_text(request['code'], 65536) or not request['code'].strip():
        raise ValueError('Python source must contain 1–65536 UTF-8 bytes.')
    files = request['files']
    if not isinstance(files, list) or len(files) > 1000:
        raise ValueError('Stage up to 1000 files.')
    seen, total, decoded = set(), 0, []
    for entry in files:
        if not isinstance(entry, dict) or set(entry) != {'path', 'data'}:
            raise ValueError('Invalid staged file metadata.')
        name = entry['path']
        if not plain_text(name, 512) or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise ValueError('Unsafe staged file path.')
        parts = name.split('/')
        if len(parts) < 2 or parts[0] not in ('skill', 'inputs') or any(p in ('', '.', '..') for p in parts):
            raise ValueError('Files must be inside skill/ or inputs/.')
        # APFS may be case-insensitive. Reject aliases before touching disk.
        import unicodedata
        key = unicodedata.normalize('NFC', name).casefold()
        if key in seen or any(key.startswith(p + '/') or p.startswith(key + '/') for p in seen):
            raise ValueError('Duplicate or conflicting staged paths.')
        seen.add(key)
        encoded = entry['data']
        if not isinstance(encoded, str) or len(encoded) > ((INPUT_LIMIT + 2) // 3) * 4:
            raise ValueError('Staged file exceeds 10 MB.')
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, UnicodeError):
            raise ValueError('Invalid staged file base64.') from None
        if base64.b64encode(data).decode('ascii') != encoded:
            raise ValueError('Noncanonical staged file base64.')
        total += len(data)
        if total > INPUT_LIMIT:
            raise ValueError('Staged files exceed the 10 MB request limit.')
        decoded.append((name, data))
    return decoded


class BoundedLog(io.TextIOBase):
    def __init__(self, limit=16384):
        self.limit = limit
        self.parts = []
        self.size = 0
        self.truncated = False

    def write(self, value):
        if not isinstance(value, str):
            raise TypeError('Log writes must be text.')
        encoded = value.encode('utf-8', errors='replace')
        remaining = self.limit - self.size
        piece = encoded[:remaining].decode('utf-8', errors='ignore')
        if piece:
            self.parts.append(piece)
        self.size += len(piece.encode('utf-8'))
        self.truncated |= len(encoded) > remaining
        return len(value)

    def getvalue(self):
        return ''.join(self.parts)


def collect_files(output):
    if output.is_symlink() or not output.is_dir():
        raise ValueError('Output directory was replaced.')
    # Only flat document outputs are supported in this prototype.
    items = []
    with os.scandir(output) as entries:
        for entry in entries:
            items.append(entry.name)
            if len(items) > 10:
                raise ValueError('Return up to ten document files.')
    result, total, seen = [], 0, set()
    import unicodedata
    for name in sorted(items):
        suffix = Path(name).suffix.lower()
        key = unicodedata.normalize('NFC', name).casefold()
        if not plain_text(name, 256) or name.startswith('.') or '/' in name or '\\' in name or any(ord(c) < 32 or ord(c) == 127 for c in name) or suffix not in MIMES or key in seen:
            raise ValueError('Outputs must be uniquely named PDF, DOCX, XLSX or PPTX files.')
        seen.add(key)
        target = output / name
        metadata = target.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_size > FILE_LIMIT:
            raise ValueError('Output must be a regular unlinked file up to 4 MB.')
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            current = os.fstat(handle.fileno())
            if not stat.S_ISREG(current.st_mode) or current.st_nlink != 1 or current.st_ino != metadata.st_ino:
                raise ValueError('Output changed during collection.')
            data = handle.read(FILE_LIMIT + 1)
        total += len(data)
        if len(data) != metadata.st_size or len(data) > FILE_LIMIT or total > TOTAL_LIMIT:
            raise ValueError('Output changed or exceeds the 8 MB total limit.')
        result.append({'name': name, 'mime': MIMES[suffix], 'data': base64.b64encode(data).decode('ascii')})
    return result


def run(request):
    staged = validate_request(request)
    root = Path.cwd()
    for directory in ('skill', 'inputs', 'output'):
        (root / directory).mkdir(mode=0o700)
    for name, data in staged:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open('xb') as handle:
            handle.write(data)
        target.chmod(0o400)
    # Use CPython's bundled MIME registry rather than consulting host Apache files.
    # openpyxl creates MimeTypes during import; the sandbox correctly denies /etc.
    import mimetypes
    mimetypes.knownfiles = []
    mimetypes.init()
    out, err = BoundedLog(), BoundedLog()
    started = time.monotonic()
    exit_code = 0
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            # This is intentionally arbitrary Python; the native worker provides
            # OS restrictions. Do not mistake exec globals for a security boundary.
            exec(compile(request['code'], '<skill-request>', 'exec'), {'__name__': '__main__', '__file__': str(root / 'request.py')})
        except BaseException:
            exit_code = 1
            traceback.print_exc(limit=8)
    files = []
    if exit_code == 0:
        try:
            files = collect_files(root / 'output')
        except (ValueError, OSError) as error:
            exit_code = 1
            err.write(str(error))
    return {'exitCode': exit_code, 'stdout': out.getvalue(), 'stderr': err.getvalue(), 'files': files,
            'peakRSSBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'logsTruncated': out.truncated or err.truncated, 'executionMs': round((time.monotonic() - started) * 1000)}


if __name__ == '__main__':
    try:
        # The only path argument is created by the native service, never the model.
        with open(sys.argv[1], 'rb') as handle:
            payload = handle.read(15 * 1024 * 1024 + 1)
        if len(payload) > 15 * 1024 * 1024:
            raise ValueError('Request exceeds the transport limit.')
        response = run(json.loads(payload))
    except Exception as error:
        response = {'exitCode': 1, 'stdout': '', 'stderr': str(error)[:1000], 'files': []}
    sys.__stdout__.write(json.dumps(response, ensure_ascii=True))

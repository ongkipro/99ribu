"""Executable format/tool-dependency regression; contains synthetic values only."""
from pathlib import Path
import subprocess
import sys
from schema_formats import FORMATS

assert FORMATS.conforms('2030-01-01T00:00:00Z', 'date-time')
assert not FORMATS.conforms('2026-02-30T00:00:00.000Z', 'date-time')
assert FORMATS.conforms('https://example.com/synthetic', 'uri')
assert not FORMATS.conforms('https://example.com/a space', 'uri')
assert FORMATS.conforms('about:blank', 'uri-reference')
assert not FORMATS.conforms('a space', 'uri-reference')
assert not FORMATS.conforms('not-a-uuid', 'uuid')

code = '''import importlib.abc, sys
class MissingFormats(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in ('rfc3339_validator', 'rfc3986_validator'):
            raise ModuleNotFoundError('Controlled missing format dependency')
        return None
sys.meta_path.insert(0, MissingFormats())
sys.path.insert(0, 'tests/contract')
import schema_formats
'''
result = subprocess.run([sys.executable, '-c', code], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=10)
assert result.returncode != 0, 'Missing required formats must fail.'
assert 'Install the pinned development contract formats' in result.stderr, 'Missing dependency must produce the explicit setup failure.'
print('PASS required date/URI/UUID formats and missing-dependency refusal')

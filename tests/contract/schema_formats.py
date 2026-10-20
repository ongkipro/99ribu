"""Shared required format assertions; missing optional packages must fail closed."""
from pathlib import Path
import sys
from jsonschema import FormatChecker

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '.local/contract-formats'))
try:
    from rfc3339_validator import validate_rfc3339
    from rfc3986_validator import validate_rfc3986
except ImportError:
    raise RuntimeError('Install the pinned development contract formats from tests/contract/requirements-formats.txt; see root README.') from None

FORMATS = FormatChecker()

@FORMATS.checks('date-time')
def date_time(value):
    return not isinstance(value, str) or bool(validate_rfc3339(value.upper()))

@FORMATS.checks('uri')
def uri(value):
    return not isinstance(value, str) or bool(validate_rfc3986(value, rule='URI'))

@FORMATS.checks('uri-reference')
def uri_reference(value):
    return not isinstance(value, str) or bool(validate_rfc3986(value, rule='URI_reference'))

if not {'date-time', 'date', 'uri', 'uri-reference', 'uuid'} <= FORMATS.checkers.keys():
    raise RuntimeError('Required contract formats are unavailable.')

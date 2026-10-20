"""Validate synthetic observed exchanges in memory; never print request/response values."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import yaml
from jsonschema import Draft202012Validator
from schema_formats import FORMATS

spec = yaml.safe_load((Path(__file__).resolve().parents[2] / 'docs/spec/openapi.yaml').read_text())

def resolve(value):
    while '$ref' in value:
        target = spec
        for part in value['$ref'][2:].split('/'):
            target = target[part]
        value = target
    return value

def remap(node):
    if isinstance(node, dict):
        return {k: (v.replace('#/components/schemas/', '#/$defs/') if k == '$ref' else remap(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [remap(v) for v in node]
    return node

definitions = remap(spec['components']['schemas'])

def valid(schema, value):
    return Draft202012Validator({**remap(schema), '$defs': definitions}, format_checker=FORMATS).is_valid(value)

def request_valid(operation, sample, path_values):
    query = parse_qs(urlsplit(sample['url']).query, keep_blank_values=True)
    parameters = [resolve(p) for p in operation.get('parameters', [])]
    if set(query) - {p['name'] for p in parameters if p['in'] == 'query'}:
        return False
    for parameter in parameters:
        values = [path_values[parameter['name']]] if parameter['in'] == 'path' and parameter['name'] in path_values else query.get(parameter['name'], []) if parameter['in'] == 'query' else [sample['request_headers'][parameter['name'].lower()]] if parameter['name'].lower() in sample['request_headers'] else []
        if not values and parameter.get('required') or len(values) > 1:
            return False
        if values:
            value = values[0]
            if parameter['schema'].get('type') == 'integer':
                if not re.fullmatch(r'[0-9]{1,' + str(len(str(parameter['schema'].get('maximum', 9007199254740991)))) + '}', value):
                    return False
                value = int(value)
            if not valid(parameter['schema'], value):
                return False
    if 'requestBody' in operation:
        media = sample['request_headers'].get('content-type', '').split(';')[0].strip().lower()
        if media != 'application/json' or sample.get('body_bytes', 0) > operation['x-request-body-limit-bytes']:
            return False
        try:
            body = json.loads(sample['request_body'])
        except (ValueError, TypeError, KeyError):
            return False
        return valid(operation['requestBody']['content'][media]['schema'], body)
    return True

def run():
    observed = json.load(sys.stdin)
    samples, group = observed['samples'], observed['group']
    assert group in spec['x-proof-groups'], 'registered proof group'
    successes, denials = set(), set()
    for index, sample in enumerate(samples):
        path = urlsplit(sample['url']).path.removeprefix('/api/v1')
        matches = []
        for template, methods in spec['paths'].items():
            parts = re.split(r'(\{[^}]+\})', template)
            pattern = ''.join('(?P<' + part[1:-1] + '>[^/]+)' if part.startswith('{') else re.escape(part) for part in parts)
            match = re.fullmatch(pattern, path)
            if match and sample['method'].lower() in methods:
                specificity = tuple(0 if re.fullmatch(r'\{[^}]+\}', segment) else 1 for segment in template.split('/'))
                matches.append((methods[sample['method'].lower()], match.groupdict(), specificity))
        # Prefer literal segments at the first differing position, including
        # static children beneath a parameterized parent such as /orders/{id}.
        if matches:
            best = max(candidate[2] for candidate in matches)
            matches = [(operation, values) for operation, values, score in matches if score == best]
        assert len(matches) == 1, f'sample {index}: unique route match'
        operation, path_values = matches[0]
        assert operation['x-contract-status'] == 'implemented-local', f'sample {index}: operation status'
        assert operation['x-proof-group'] == group, f'sample {index}: operation proof ownership'
        if 'request_valid' in sample:
            assert request_valid(operation, sample, path_values) == sample['request_valid'], f'sample {index}: request schema'
        status = str(sample['status'])
        assert status in operation['responses'], f'sample {index}: undeclared response status'
        response = resolve(operation['responses'][status])
        media = sample['headers']['content-type'].split(';')[0]
        assert media in response['content'], f'sample {index}: response media type'
        assert valid(response['content'][media]['schema'], sample['payload']), f'sample {index}: response schema'
        for header, value in [('cache-control', 'no-store'), ('referrer-policy', 'no-referrer'), ('x-content-type-options', 'nosniff')]:
            assert sample['headers'].get(header) == value, f'sample {index}: private response headers'
        if sample['status'] >= 400:
            assert sample['payload']['status'] == sample['status'], f'sample {index}: Problem status'
            assert valid({'type': 'string', 'format': 'uuid'}, sample['payload'].get('request_id')), f'sample {index}: redacted request ID'
            denials.add(operation['operationId'])
        else:
            successes.add(operation['operationId'])
        if sample['status'] == 429:
            delay = sample['headers'].get('retry-after', '')
            assert delay.isdigit() and int(delay) > 0, f'sample {index}: retry timing'
    implemented = {o['operationId'] for methods in spec['paths'].values() for o in methods.values() if o['x-contract-status'] == 'implemented-local' and o['x-proof-group'] == group}
    assert implemented and successes == implemented and denials == implemented, 'each implemented operation needs observed success and denial'
    # A permissive/broken validator must not silently turn this evidence green.
    assert not valid({'$ref': '#/components/schemas/Me'}, {'id': 'fixture', 'roles': []}), 'missing-field validation canary'
    assert not valid({'$ref': '#/components/schemas/Me'}, {'id': 'fixture', 'roles': [], 'warehouse_ids': [], 'cost': 1}), 'extra-field validation canary'
    assert not valid({'$ref': '#/components/schemas/DateTime'}, '2026-02-30T00:00:00.000Z'), 'invalid-date validation canary'
    assert not valid({'type': 'string', 'format': 'uri'}, 'https://example.com/a space'), 'invalid-URI validation canary'
    assert not valid({'type': 'string', 'format': 'uri-reference'}, 'a space'), 'invalid-URI-reference validation canary'
    print(json.dumps({'ok': True, 'exchanges': len(samples), 'operations': len(successes)}))

try:
    run()
except Exception as error:
    # Validation assertions contain labels only; dependencies may expose raw values.
    print(str(error) if isinstance(error, AssertionError) else 'Contract probe failed without payload disclosure.', file=sys.stderr)
    sys.exit(1)

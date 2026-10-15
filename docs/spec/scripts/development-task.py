#!/usr/bin/env python3
"""Read-only slice validation and prompt extraction from the canonical TASKS.md."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import sys

PACK = Path(__file__).resolve().parents[1]
PROMOTED = PACK.name == 'spec' and PACK.parent.name == 'docs'
ROOT = PACK.parent.parent if PROMOTED else PACK
TASKS = ROOT / 'TASKS.md'


def table(text, marker, columns):
    start = f'<!-- {marker}:start -->'
    end = f'<!-- {marker}:end -->'
    if text.count(start) != 1 or text.count(end) != 1:
        raise ValueError(f'{marker}: expected one marked table')
    if text.index(end) < text.index(start):
        raise ValueError(f'{marker}: closing marker precedes opening marker')
    part = text.split(start)[1].split(end)[0]
    rows = []
    for line in part.splitlines():
        if not line.startswith('|'):
            continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if cells[0] in ('Slice', 'Scenario') or re.fullmatch(r'[-: ]+', cells[0]):
            continue
        if len(cells) != columns:
            raise ValueError(f'{marker}: expected {columns} columns: {line}')
        rows.append(cells)
    return rows


def parse_plan(text):
    matches = list(re.finditer(r'^### (T-\d+) — (.+)$', text, re.M))
    parents = {}
    for m in matches:
        identifier, title = m.groups()
        if identifier in parents:
            raise ValueError(f'duplicate parent {identifier}')
        end = text.find('\n### ', m.end())
        body = text[m.end():end if end >= 0 else len(text)]
        fields = {}
        field_names = set()
        for name, value in re.findall(r'^- \*\*([^*]+):\*\*[ \t]*(.*)$', body, re.M):
            normalized = name.strip().casefold()
            if normalized in field_names:
                raise ValueError(f'{identifier}: duplicate field {name}')
            field_names.add(normalized)
            fields[name] = value
        parents[identifier] = {'title': title, 'fields': fields}
    slices = table(text, 'development-slices', 5)
    scenarios = table(text, 'scenario-owners', 3)
    return parents, slices, scenarios


def load():
    parents, slices, scenarios = parse_plan(TASKS.read_text())
    fixtures = json.loads((PACK / 'fixtures/localhost-commerce.json').read_text())
    return parents, slices, scenarios, [x['case'] for x in fixtures['simulations']]


def validate(parents, slices, scenarios, cases):
    errors = []
    if set(parents) != {f'T-{n}' for n in range(1, 40)}:
        errors.append('parent inventory must preserve T-1 through T-39')
    seen, covered = set(), set()
    for sid, parent, after, delivery, proof in slices:
        if not re.fullmatch(r'S\d{2,}', sid) or sid in seen:
            errors.append(f'invalid/duplicate slice {sid}')
        if parent not in parents:
            errors.append(f'{sid}: unknown parent {parent}')
        if parent == 'T-19':
            errors.append('T-19 is deferred, not a current local slice')
        dependencies = [] if after == '-' else after.split(',')
        if len(set(dependencies)) != len(dependencies):
            errors.append(f'{sid}: duplicate predecessor')
        for dep in dependencies:
            if dep not in seen:
                errors.append(f'{sid}: predecessor {dep} missing, self-referencing or after consumer')
        if sid != 'S01' and not dependencies:
            errors.append(f'{sid}: must name a prerequisite checkpoint')
        if not delivery or not proof:
            errors.append(f'{sid}: missing delivery or proof')
        seen.add(sid)
        covered.add(parent)
    if covered != set(parents) - {'T-19'}:
        errors.append('local slice coverage must equal all parents except deferred T-19')
    if not {f'S{n:02}' for n in range(1, 69)}.issubset(seen):
        errors.append('preserve every accepted slice identity S01 through S68')
    if not slices or slices[-1][:2] != ['S68', 'T-39']:
        errors.append('S68 under T-39 must remain the terminal local gate')
    graph = {row[0]: [] if row[2] == '-' else row[2].split(',') for row in slices}
    reachable, pending = set(), ['S68']
    while pending:
        sid = pending.pop()
        if sid not in reachable:
            reachable.add(sid)
            pending.extend(graph.get(sid, []))
    if seen - reachable:
        errors.append('S68 must transitively require every local slice: ' + ', '.join(sorted(seen - reachable)))
    for parent, data in parents.items():
        fields = data['fields']
        if not re.fullmatch(r'(PR|TD)-\d+', fields.get('Primary requirement', '')):
            errors.append(f'{parent}: expected one primary requirement')
        for field in ('Risk Level', 'Allowed Paths', 'Depends On', 'Done when'):
            if not fields.get(field):
                errors.append(f'{parent}: missing {field}')
        if fields.get('Risk Level') not in ('R0', 'R1', 'R2', 'R3', 'R4'):
            errors.append(f'{parent}: invalid risk')
        for dep in re.findall(r'T-\d+', fields.get('Depends On', '')):
            if dep not in parents or dep == parent:
                errors.append(f'{parent}: invalid parent dependency {dep}')
    # Parent graph is a family-level cross-check; exact entry proofs live in slices.
    visiting, visited = set(), set()
    def walk(parent):
        if parent in visiting:
            errors.append(f'parent dependency cycle at {parent}')
            return
        if parent in visited or parent not in parents:
            return
        visiting.add(parent)
        for dep in re.findall(r'T-\d+', parents[parent]['fields'].get('Depends On', '')):
            walk(dep)
        visiting.remove(parent)
        visited.add(parent)
    for parent in parents:
        walk(parent)
    names = [row[0] for row in scenarios]
    if len(set(cases)) != len(cases) or len(set(names)) != len(names) or set(names) != set(cases):
        errors.append('fixture scenarios must have exactly one owner each, with no extra case')
    for case, owner, proof in scenarios:
        if owner not in seen or not proof:
            errors.append(f'{case}: missing owner/proof')
    return errors


def mutation_checks(data):
    # Deliberately invalid plans must fail; this does not prove application behavior.
    mutations = [
        lambda p,s,o,c: s.append(s[0].copy()),
        lambda p,s,o,c: s[1].__setitem__(2, 'S99'),
        lambda p,s,o,c: s[0].__setitem__(2, 'S01'),
        lambda p,s,o,c: s[0].__setitem__(1, 'T-99'),
        lambda p,s,o,c: s[0].__setitem__(1, 'T-19'),
        lambda p,s,o,c: s.__setitem__(slice(None), [x for x in s if x[1] != 'T-15']),
        lambda p,s,o,c: o.pop(),
        lambda p,s,o,c: o.append(o[0].copy()),
        lambda p,s,o,c: o[0].__setitem__(1, 'S99'),
        lambda p,s,o,c: s[0].__setitem__(4, ''),
        lambda p,s,o,c: p['T-1']['fields'].__setitem__('Primary requirement', 'PR-1 PR-2'),
        lambda p,s,o,c: p['T-23']['fields'].__setitem__('Depends On', 'T-1'),
        lambda p,s,o,c: s.pop(),
        lambda p,s,o,c: s[-1].__setitem__(2, 'S01'),
        lambda p,s,o,c: s.append(['S69', 'T-39', 'S68', 'unreviewed follow-up', 'proof']),
        lambda p,s,o,c: s[-1].__setitem__(1, 'T-23'),
    ]
    for number, mutate in enumerate(mutations, 1):
        changed = deepcopy(data)
        mutate(*changed)
        if not validate(*changed):
            raise ValueError(f'invalid plan mutation {number} was accepted')
    return len(mutations)


def parser_checks(text):
    # Duplicate declarations must fail at the input boundary, before dict conversion.
    for name in ('Primary requirement', 'Allowed Paths', 'Done when'):
        pattern = rf'^- \*\*{re.escape(name)}:\*\* (.+)$'
        match = re.search(pattern, text, re.M)
        if match is None:
            raise ValueError(f'missing parser regression input {name}')
        duplicate = {
            'Primary requirement': '- **Primary requirement:** PR-2',
            'Allowed Paths': '- **allowed paths:** unexpected/**',
            'Done when': '- **Done when:**',
        }[name]
        changed = text[:match.end()] + '\n' + duplicate + text[match.end():]
        try:
            parse_plan(changed)
        except ValueError as error:
            if 'duplicate field' not in str(error):
                raise
        else:
            raise ValueError(f'duplicate {name} was accepted')
    return 3


def emit_prompt(mode, row, parents, scenarios):
    sid, parent, after, delivery, proof = row
    fields = parents[parent]['fields']
    location = str(ROOT) if PROMOTED else '/home/ongki/Projects/99ribu (future target; inspect before creating)'
    print(f'# {mode.capitalize()} {sid} — {parent}: {parents[parent]["title"]}')
    print(f'\nCanonical task source: {TASKS}')
    print(f'Application root: {location}')
    print(f'Primary requirement: {fields["Primary requirement"]}; risk: {fields["Risk Level"]}')
    print(f'Predecessor checkpoint evidence required: {after}')
    print(f'\nDeliverable: {delivery}\nRequired proof: {proof}')
    print(f'\nCandidate allowed paths (narrow before execution): {fields["Allowed Paths"]}')
    for key in ('Constraints', 'Canonical Contract Owners', 'Accepted Invariants', 'Visual Contract', 'Non-Scope', 'Escalation Conditions', 'Done when'):
        if key in fields:
            print(f'{key}: {fields[key]}')
    owned = [name for name, owner, _ in scenarios if owner == sid]
    print(f'Owned fixture cases: {", ".join(owned) or "Use focused parent TEST acceptance; no named fixture case assigned."}')
    print('\nRead root AGENTS, STATUS and the selected parent/slice; then its primary requirement, affected data/IAM/API and UX/design contracts only. Inspect actual code/callers, Git root/HEAD and dirty files. Repository truth outranks this prompt. Check that all predecessor proofs are current; do not infer completion from a table row.')
    if not PROMOTED:
        print('STAGING: this output is a planning prompt. No application exists here. S01 uses document15 promotion and handoff/root merge material; other slices require an authorized canonical repository. Do not silently implement in this staging directory.')
    if mode == 'review':
        print('\nAct as a real independent reviewer, not the implementer. Read the final diff and exact scope, run relevant safe reproduction/negative checks and inspect persistence/browser proof. Audit requirement/consumer parity, idempotency, permissions, failure recovery, privacy, visual states and out-of-scope changes as applicable. Report severity, file/line, trigger, expected versus actual, smallest fix and recheck. Do not invent reviewer identity or approve merely because tests are green. Bind review to final content; fixes invalidate affected prior review/checks. This prompt authorizes no mutation by itself.')
    else:
        print('\nExecute only within the user-authorized scope. Declare the smallest exact boundary and protected files; use real worker/model provenance. Reuse project conventions. Implement this checkpoint end-to-end, keep auth/PostgreSQL/domain/worker real, simulate only external effects. Use actual runner-native commands from root README, reject empty/skipped required runs, inspect resulting state, and obtain real rendered/design evidence for visible changes. R3/R4 and protected/expanded changes require a separate capable reviewer after checks. Fix findings and rerun affected checks before advancing.')
    print('\nPersist exact commands, nonzero selected case counts, result, environment, safe evidence paths and remaining gaps through delivery-ledger plus root STATUS/BUILD-LOG. Finish only with a current boundary/review. On interruption preserve work and record active slice, failure and exact next action. Do not mark the whole parent complete from a partial local checkpoint. No secrets, real money/shipping/ads/messages, destructive reset, commit, push or remote deploy is authorized by this generated text.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'list', 'prompt', 'review'))
    parser.add_argument('slice', nargs='?')
    args = parser.parse_args()
    if args.action in ('prompt', 'review') and not args.slice:
        parser.error('prompt/review requires a slice ID')
    if args.action in ('check', 'list') and args.slice:
        parser.error('check/list does not accept a slice ID')
    canonical = Path.home() / 'Projects/99ribu/docs/spec/CONTEXT-RECORD.md'
    if not PROMOTED and canonical.exists():
        raise ValueError('repository pack exists; use its canonical docs/spec/scripts/development-task.py')
    data = load()
    errors = validate(*data)
    if errors:
        raise ValueError('\n'.join(errors))
    parents, slices, scenarios, _ = data
    if args.action == 'check':
        rejected = mutation_checks(data) + parser_checks(TASKS.read_text())
        print(f'PASS: {len(parents)} parents; {len(slices)} ordered slices; {len(scenarios)} scenario owners; {rejected} invalid plans rejected. Planning only; no app executed.')
    elif args.action == 'list':
        for sid, parent, after, delivery, _ in slices:
            print(f'{sid}  {parent:4}  after {after:24}  {delivery}')
    else:
        row = next((row for row in slices if row[0] == args.slice), None)
        if row is None:
            raise ValueError(f'unknown slice: {args.slice}')
        emit_prompt(args.action, row, parents, scenarios)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)

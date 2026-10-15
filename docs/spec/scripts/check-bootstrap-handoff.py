#!/usr/bin/env python3
"""Exercise promotion in a disposable orphan worktree; never scaffold an app."""
import hashlib
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory


PACK = Path(__file__).resolve().parents[1]


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise RuntimeError(f'symlink not accepted: {path}')
        if not path.is_file():
            continue
        if (path.name == '.env' or path.name.startswith('.env.')
                or path.name in ('secrets.env', 'credentials.json')
                or path.suffix in ('.pem', '.key', '.p12', '.pfx')):
            raise RuntimeError(f'potential secret file excluded: {path.name}')
        result[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def run(command, expected=0, env=None):
    process = subprocess.run(command, text=True, capture_output=True, env=env, timeout=90)
    if process.returncode != expected:
        # Test inputs contain synthetic data only. Keep failures bounded.
        detail = (process.stderr or process.stdout)[-2000:]
        raise RuntimeError(f'{Path(command[0]).name} returned {process.returncode}, '
                           f'expected {expected}: {detail}')
    return process


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    if PACK.name == 'spec' and PACK.parent.name == 'docs':
        raise RuntimeError('initial-import rehearsal requires the pre-repository staged pack; '
                           'do not treat a promoted pack as new staging input')
    tools = {}
    for name in ('git', 'project-init', 'delivery-ledger', 'npm'):
        found = shutil.which(name)
        if not found:
            raise RuntimeError(f'required installed tool missing: {name}')
        tools[name] = str(Path(found).resolve())
    before = inventory(PACK)
    require({'CONTEXT-RECORD.md', '02-PRD.md', 'TASKS.md'} <= set(before),
            'this checker requires a complete specification pack')
    with TemporaryDirectory(prefix='99ribu-handoff-check-') as temporary:
        root = Path(temporary)
        anchor, worktree = root / 'anchor', root / 'feature'
        # Isolate Git configuration/hooks and parent-worktree environment overrides.
        env = dict(os.environ)
        for key in list(env):
            if key.startswith('GIT_'):
                del env[key]
        env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                   GIT_TERMINAL_PROMPT='0')
        run([tools['git'], '-c', 'init.templateDir=', 'init', '-q', str(anchor)], env=env)
        run([tools['git'], '-C', str(anchor), 'worktree', 'add', '--orphan',
             '-b', 'handoff-proof', str(worktree)], env=env)
        source = worktree / 'src/app/sentinel.txt'
        source.parent.mkdir(parents=True)
        source.write_text('synthetic source sentinel; no generated application\n')
        (worktree / 'README.md').write_text('# Synthetic preserved README\n')
        sentinels = {p: p.read_bytes() for p in (source, worktree / 'README.md')}
        args = [tools['project-init'], '--repo', str(worktree), '--stack',
                'existing-repository', '--from-docs', str(PACK), '--no-install']
        tree_before = inventory(root)
        plan = run([*args, '--plan'], env=env)
        require(tree_before == inventory(root), 'read-only plan mutated temporary files')
        require('Generator: none' in plan.stdout and 'Planning layout: suite-pack' in plan.stdout,
                'plan did not select generator-free suite promotion')
        print('PASS: existing-repository --plan is generator-free and leaves files unchanged')
        promoted = run(args, expected=2, env=env)
        require('BLOCKED' in promoted.stdout + promoted.stderr,
                '--no-install did not disclose its blocked verification state')
        for relative, digest in before.items():
            target = (worktree / relative if relative in ('TASKS.md', 'PLAN.md')
                      else worktree / 'docs/spec' / relative)
            require(target.is_file(), f'missing promoted file: {relative}')
            require(hashlib.sha256(target.read_bytes()).hexdigest() == digest,
                    f'promoted bytes differ: {relative}')
        for path, content in sentinels.items():
            require(path.read_bytes() == content, 'promotion changed a source sentinel')
        require('docs/spec/02-PRD.md' in (worktree / 'PRD.md').read_text(),
                'root PRD does not point to canonical product requirements')
        require(not (worktree / 'docs/spec/TASKS.md').exists(), 'duplicate promoted task queue')
        require(not (worktree / 'node_modules').exists(), 'unexpected dependency installation')
        print(f'PASS: expected exit 2/BLOCKED; {len(before)} files promoted byte-identically; '
              'root TASKS/PRD and source sentinels preserved')
        ledger = [sys.executable, tools['delivery-ledger'], '--repo', str(worktree)]
        run([*ledger, 'start', '--task', 'S01-HANDOFF-PROBE', '--requirement', 'TD-1',
             '--risk', 'R1', '--worker', 'handoff-checker',
             '--model', 'unavailable: deterministic script',
             '--provider', 'unavailable: deterministic script',
             '--reasoning-effort', 'unavailable: deterministic script',
             '--allow', 'handoff-probe.txt'], env=env)
        (worktree / 'handoff-probe.txt').write_text('synthetic probe\n')
        probe = "from pathlib import Path; assert Path('handoff-probe.txt').read_text() == 'synthetic probe\\n'"
        command = f'{shlex.quote(sys.executable)} -c {shlex.quote(probe)}'
        run([*ledger, 'record', '--check', 'synthetic-probe', '--command', command], env=env)
        run([*ledger, 'check-boundary'], env=env)
        run([*ledger, 'finish', '--result', 'PASS', '--detail',
             'Synthetic promotion probe only; no application or deployment'], env=env)
        run([*ledger, 'verify'], env=env)
        head = subprocess.run([tools['git'], '-C', str(worktree), 'rev-parse',
                               '--verify', 'HEAD^{commit}'], capture_output=True, env=env)
        require(head.returncode != 0, 'unexpected commit in synthetic worktree')
        print('PASS: unborn worktree R1 executed check/boundary/finish and ledger integrity; no commit')
    require(before == inventory(PACK), 'source pack changed during the handoff test')
    print('PASS: source pack hashes unchanged; no app scaffold, install, network or Projects mutation')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)

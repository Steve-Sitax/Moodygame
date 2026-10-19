"""Read-only #171/#199 resource provenance check; never launches Godot or writes assets.

python native-godot/scripts/check-landmark-paving.py --against main
Use --revision <commit> to inspect committed resources instead of the working tree.
Support hashes in resources.json are historical Godot promotion/reload evidence,
not a new runtime support or navigation check.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--against', default='main')
    parser.add_argument('--revision')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    manifest = json.loads((root / 'art-source/landmark-paving-20261019/resources.json').read_text())

    def blob(revision, path):
        return subprocess.check_output(['git', 'show', revision + ':' + path], cwd=root)

    def sha(data):
        return hashlib.sha256(data).hexdigest()

    failures = []
    resources = manifest['resources']
    if len(resources) != 61 or len({r['path'] for r in resources}) != 61:
        raise SystemExit('Expected 61 distinct resource paths')
    for record in resources:
        path = record['path']
        if not path.startswith('native-godot/world/town/resources/') or not path.endswith('.res'):
            raise SystemExit('Unexpected resource path: ' + path)
        actual = blob(args.revision, path) if args.revision else (root / path).read_bytes()
        if sha(actual) != record['installedSha256']:
            failures.append('Final resource differs: ' + path)
        if sha(blob(manifest['sourceCommit'], path)) != record['installedSha256']:
            failures.append('Source commit differs: ' + path)
        if sha(blob(manifest['baseCommit'], path)) != record['baseSha256']:
            failures.append('Original base differs: ' + path)
        if sha(blob(args.against, path)) not in (record['baseSha256'], record['installedSha256']):
            failures.append('Upstream resource conflict: ' + path)
    if failures:
        raise SystemExit('\n'.join(failures))
    print('PASS: 61 final resources, source/base SHA-256 provenance, and no resource conflicts with ' + args.against)


if __name__ == '__main__':
    main()

"""Explicit maintainer operation: freeze the cleaned evidence and upstream inputs.

The ordinary build is offline and reads only these compressed, hashed baselines.
"""
import gzip
import argparse
import hashlib
import json
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'data/baseline'
COMMIT = 'e104eb6da5f9509beceb563e92257ec5d314bc66'


def save(name, content):
    (BASE / (name + '.gz')).write_bytes(gzip.compress(content, mtime=0))
    return {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}


def main(as_of, evidence_only=False):
    BASE.mkdir(parents=True, exist_ok=True)
    datetime.strptime(as_of, '%Y-%m-%d')
    manifest = json.loads((BASE / 'manifest.json').read_text(encoding='utf-8')) if evidence_only else {'schemaVersion': 1, 'scoringCommit': COMMIT, 'files': {}}
    manifest['asOf'] = as_of
    db = sqlite3.connect(ROOT / 'data/cleaned/competitions.sqlite')
    # Preserve original attribution evidence, identities, uncertainty and all source IDs.
    results = [json.loads(row[0]) for row in db.execute('select detail_json from results order by result_id')]
    for result in results:
        result.pop('observation_ids', None)
    content = '\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in results).encode()
    manifest['files']['results.jsonl'] = save('results.jsonl', content)
    sources = [dict(zip(['id', 'url', 'type'], row)) for row in db.execute('select * from sources order by source_id')]
    manifest['files']['sources.json'] = save('sources.json', json.dumps(sources, ensure_ascii=False).encode())
    db.close()
    if evidence_only:
        (BASE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'Updated evidence baseline: {len(results)} results, {len(sources)} sources')
        return
    # These artifact hashes pin the UID identity snapshot independently of scoring source.
    for name, suffix in [('static', 'json'), ('result', 'txt')]:
        host = 'https://oier.api.baoshuo.dev/'
        meta = json.load(urllib.request.urlopen(host + name + '.info.json', timeout=60))
        url = host + name + '.' + meta['sha512'][:7] + '.' + suffix
        data = urllib.request.urlopen(url, timeout=120).read()
        if hashlib.sha512(data).hexdigest() != meta['sha512'] or len(data) != meta['size']:
            raise ValueError('Upstream snapshot hash mismatch')
        manifest['files'][name + '.' + suffix] = {**save(name + '.' + suffix, data), 'url': url, 'sha512': meta['sha512']}
    upstream = f'https://raw.githubusercontent.com/OIerDb-ng/OIerDb/{COMMIT}/'
    for path in ['data/raw.txt', 'data/contests.json', 'data/scoring.json', 'data/surnames.json', 'data/name_exceptions.json']:
        data = urllib.request.urlopen(upstream + path, timeout=120).read()
        name = path.split('/')[-1]
        manifest['files'][name] = {**save(name, data), 'url': upstream + path}
    license_text = urllib.request.urlopen(upstream + 'LICENSE', timeout=60).read()
    (ROOT / 'LICENSE').write_bytes(license_text)
    (BASE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Frozen {len(results)} results, {len(sources)} sources')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--as-of', default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument('--evidence-only', action='store_true', help='Refresh cleaned evidence using the existing pinned UID and scoring baseline')
    args = parser.parse_args()
    main(args.as_of, args.evidence_only)

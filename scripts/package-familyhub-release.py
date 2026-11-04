"""Run in release CI after immutable image digests have been returned by Buildx."""
import hashlib
import json
import os
from pathlib import Path
import re
import tarfile

version = os.environ['VERSION']
if not re.fullmatch(r'familyhub-v\d+\.\d+\.\d+', version):
    raise ValueError('Invalid version')
root = Path(__file__).resolve().parents[1]
source = root / 'deploy/familyhub'
files = ['compose.yml', 'compose.vpn.yml', 'Caddyfile', 'images.yml', 'release.py']
output = root / 'release-output'
output.mkdir(exist_ok=True)
manifest = {'schema': 1, 'version': version, 'commit': os.environ['GITHUB_SHA'],
            'rollbackSafe': json.loads((source / 'release-policy.json').read_text())['rollbackSafe'],
            'files': {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in files}}
for service in ['server', 'client']:
    digest = os.environ[service.upper() + '_DIGEST']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise ValueError('Invalid image digest')
    manifest[service + 'Image'] = 'ghcr.io/santoshgs/familyhub-' + service + '@' + digest
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
with tarfile.open(output / (version + '.tar.gz'), 'w:gz') as archive:
    for name in files + ['env.example']:
        archive.add(source / name, arcname=name)
    archive.add(output / 'manifest.json', arcname='manifest.json')

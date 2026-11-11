"""Linux integration check for first release, upgrades and rollback."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux deployment integration')
class DeploymentTests(unittest.TestCase):
    def test_release_upgrade_and_rollback(self):
        with tempfile.TemporaryDirectory(prefix='oier-deploy-') as directory:
            base = Path(directory)
            site = base / 'site'
            environment = {**os.environ, 'SITE_ROOT': str(site)}
            for generation in [1, 2]:
                version = str(generation) * 16
                source = base / f'build-{generation}'
                (source / 'data' / version).mkdir(parents=True)
                (source / 'assets').mkdir()
                (source / 'assets' / f'{generation}.js').write_text('console.log(1)')
                (source / 'index.html').write_text(str(generation))
                (source / 'data/manifest.json').write_text(json.dumps({'version': version}))
                (source / 'data' / version / 'coaches.json').write_text('[]')
                subprocess.run(['bash', str(ROOT / 'deploy/release.sh'), str(source)], env=environment, check=True)
                self.assertEqual((site / 'current/index.html').read_text(), str(generation))
            self.assertEqual((site / 'previous/index.html').read_text(), '1')
            self.assertTrue((site / 'current/data' / ('1' * 16) / 'coaches.json').exists())
            subprocess.run(['bash', str(ROOT / 'deploy/rollback.sh')], env=environment, check=True)
            self.assertEqual((site / 'current/index.html').read_text(), '1')
            self.assertTrue((site / 'current/data' / ('2' * 16) / 'coaches.json').exists())
            self.assertEqual(json.loads((site / 'current/data/manifest.json').read_text())['version'], '1' * 16)
            subprocess.run(['bash', str(ROOT / 'deploy/rollback.sh')], env=environment, check=True)
            self.assertEqual((site / 'current/index.html').read_text(), '2')


if __name__ == '__main__':
    unittest.main()

import { npmCommand, publicPackages, run } from './package-utils.mjs';

const username = run(npmCommand(), ['whoami']).trim();
if (!username) {
  throw new Error('npm whoami returned an empty username.');
}

run(npmCommand(), ['ping'], process.cwd(), { stdio: 'inherit' });

for (const pkg of publicPackages) {
  run(npmCommand(), ['publish', '--dry-run', '--access', 'public'], pkg.dir, {
    stdio: 'inherit',
    env: {
      npm_config_provenance: 'true',
    },
  });
}

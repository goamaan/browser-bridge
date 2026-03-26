import path from 'node:path';
import { bunCommand, run } from './package-utils.mjs';

run(bunCommand(), ['x', 'playwright', 'install', 'chromium'], path.join(process.cwd(), 'packages', 'core'), {
  stdio: 'inherit',
});

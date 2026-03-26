import { rmSync } from 'node:fs';

for (const path of [
  'packages/core/dist',
  'packages/sdk/dist',
  'packages/cli/dist',
  'packages/core/tsconfig.tsbuildinfo',
  'packages/sdk/tsconfig.tsbuildinfo',
  'packages/cli/tsconfig.tsbuildinfo',
]) {
  rmSync(path, { force: true, recursive: true });
}

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { resolveDaemonEntryFrom } from '../src/daemon/client.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const directory = tmpDirs.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('resolveDaemonEntryFrom', () => {
  it('resolves the daemon entry from a packaged CLI install layout', () => {
    const root = createTempDir('packaged-cli-');
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'live-browser' }, null, 2));
    mkdirSync(path.join(root, 'dist', 'bin'), { recursive: true });
    const daemonEntry = path.join(root, 'dist', 'bin', 'live-browser-daemon.js');
    writeFileSync(daemonEntry, 'console.log("daemon");');

    const currentFile = path.join(root, 'dist', 'index.js');
    writeFileSync(currentFile, 'console.log("cli");');

    assert.equal(resolveDaemonEntryFrom(currentFile), daemonEntry);
  });

  it('resolves the daemon entry from the workspace core dist layout', () => {
    const root = createTempDir('workspace-core-');
    const packageRoot = path.join(root, 'packages', 'core');
    mkdirSync(path.join(packageRoot, 'dist', 'daemon'), { recursive: true });
    mkdirSync(path.join(packageRoot, 'dist', 'bin'), { recursive: true });
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'live-browser-internal-core' }, null, 2));
    const daemonEntry = path.join(packageRoot, 'dist', 'bin', 'live-browser-daemon.js');
    writeFileSync(daemonEntry, 'console.log("daemon");');

    const currentFile = path.join(packageRoot, 'dist', 'daemon', 'client.js');
    writeFileSync(currentFile, 'console.log("client");');

    assert.equal(resolveDaemonEntryFrom(currentFile), daemonEntry);
  });
});

function createTempDir(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(directory);
  return directory;
}

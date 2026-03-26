import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bunCommand, npmCommand, packPackage, publicPackages, run } from './package-utils.mjs';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'browser-bridge-consumer-'));
const tarballDir = path.join(tmpDir, 'tarballs');
const bunProjectDir = path.join(tmpDir, 'bun-project');
const npmProjectDir = path.join(tmpDir, 'npm-project');

try {
  run(bunCommand(), ['run', 'build']);

  const tarballs = publicPackages.map((pkg) => ({
    name: pkg.name,
    file: packPackage(pkg, tarballDir),
  }));

  smokeBunInstall(tarballs);
  smokeNpmInstall(tarballs);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

function smokeBunInstall(tarballs) {
  const coreTarball = getTarball(tarballs, '@goamaan/browser-bridge-core');
  const sdkTarball = getTarball(tarballs, '@goamaan/browser-bridge-sdk');
  const cliTarball = getTarball(tarballs, '@goamaan/browser-bridge');
  const coreDependency = toFileDependency(bunProjectDir, coreTarball);
  const sdkDependency = toFileDependency(bunProjectDir, sdkTarball);
  const cliDependency = toFileDependency(bunProjectDir, cliTarball);

  writeProjectManifest(bunProjectDir, 'consumer-bun-smoke', {
    '@goamaan/browser-bridge-core': coreDependency,
    '@goamaan/browser-bridge-sdk': sdkDependency,
    '@goamaan/browser-bridge': cliDependency,
  }, {
    '@goamaan/browser-bridge-core': coreDependency,
    '@goamaan/browser-bridge-sdk': sdkDependency,
  });

  run(bunCommand(), ['install'], bunProjectDir, { stdio: 'inherit' });
  const helpOutput = run(bunCommand(), ['x', 'browser-bridge', '--help'], bunProjectDir);
  assert.match(helpOutput, /Usage: browser-bridge/);

  const skillBase = path.join(bunProjectDir, 'skill-output');
  run(bunCommand(), ['x', 'browser-bridge', 'skill', 'install', '--project', skillBase], bunProjectDir, { stdio: 'inherit' });
  assert.ok(existsSync(path.join(skillBase, '.agents', 'skills', 'browser-bridge', 'SKILL.md')));
}

function smokeNpmInstall(tarballs) {
  const coreTarball = getTarball(tarballs, '@goamaan/browser-bridge-core');
  const sdkTarball = getTarball(tarballs, '@goamaan/browser-bridge-sdk');
  const cliTarball = getTarball(tarballs, '@goamaan/browser-bridge');
  const coreDependency = toFileDependency(npmProjectDir, coreTarball);
  const sdkDependency = toFileDependency(npmProjectDir, sdkTarball);
  const cliDependency = toFileDependency(npmProjectDir, cliTarball);

  writeProjectManifest(npmProjectDir, 'consumer-npm-smoke', {
    '@goamaan/browser-bridge-core': coreDependency,
    '@goamaan/browser-bridge-sdk': sdkDependency,
    '@goamaan/browser-bridge': cliDependency,
  }, {
    '@goamaan/browser-bridge-core': coreDependency,
    '@goamaan/browser-bridge-sdk': sdkDependency,
  });

  run(npmCommand(), ['install'], npmProjectDir, { stdio: 'inherit' });
  const helpOutput = run(npmCommand(), ['exec', '--', 'browser-bridge', '--help'], npmProjectDir);
  assert.match(helpOutput, /Usage: browser-bridge/);

  const skillBase = path.join(npmProjectDir, 'skill-output');
  run(npmCommand(), ['exec', '--', 'browser-bridge', 'skill', 'install', '--project', skillBase], npmProjectDir, {
    stdio: 'inherit',
  });
  assert.ok(existsSync(path.join(skillBase, '.agents', 'skills', 'browser-bridge', 'SKILL.md')));
}

function writeProjectManifest(directory, name, dependencies = {}, overrides = {}) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        dependencies,
        overrides,
      },
      null,
      2,
    ),
  );
}

function getTarball(tarballs, packageName) {
  const match = tarballs.find((tarball) => tarball.name === packageName);
  if (!match) {
    throw new Error(`Missing tarball for ${packageName}.`);
  }

  return match.file;
}

function toFileDependency(projectDir, filePath) {
  const relativePath = path.relative(projectDir, filePath).split(path.sep).join('/');
  return `file:${relativePath}`;
}

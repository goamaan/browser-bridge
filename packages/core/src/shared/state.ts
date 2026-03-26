import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserStateDir, browserStatePath } from './paths.js';
import type { LiveBrowserAttachOptions, ManagedBrowserLaunchOptions } from './types.js';

export interface PersistedPageRecord {
  targetId: string;
  title: string;
  url: string;
  lastSeenAt: string;
}

export interface PersistedAliasRecord {
  alias: string;
  targetId: string;
  title: string;
  url: string;
  lastSeenAt: string;
}

export interface BrowserStateRecord {
  version: 1;
  browserId: string;
  mode: 'live' | 'managed';
  label: string;
  attachedAt: string;
  updatedAt: string;
  liveOptions?: LiveBrowserAttachOptions;
  managedOptions?: ManagedBrowserLaunchOptions;
  aliases: PersistedAliasRecord[];
  pages: PersistedPageRecord[];
}

export async function readBrowserState(browserId: string): Promise<BrowserStateRecord | null> {
  const filePath = browserStatePath(browserId);
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as BrowserStateRecord;
}

export async function writeBrowserState(state: BrowserStateRecord): Promise<string> {
  const filePath = browserStatePath(state.browserId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function deleteBrowserState(browserId: string): Promise<void> {
  await rm(browserStatePath(browserId), { force: true });
}

export async function listBrowserStates(): Promise<BrowserStateRecord[]> {
  const dir = browserStateDir();
  const entries = await readDirSafe(dir);
  const states: BrowserStateRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    try {
      const raw = await readFile(path.join(dir, entry), 'utf8');
      states.push(JSON.parse(raw) as BrowserStateRecord);
    } catch {
      // Ignore malformed state files; doctor will surface active issues.
    }
  }
  return states;
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    const fs = await import('node:fs/promises');
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

# browser-bridge

`browser-bridge` is a live-first browser automation toolkit for AI agents.

It can attach to an already-open Chrome session over raw CDP, keep page aliases warm across commands, and fall back to managed Chromium when you want a clean browser instead of a live one.

## Install

```bash
bunx @goamaan/browser-bridge --help
npx @goamaan/browser-bridge --help
```

For a persistent install:

```bash
bun add -g @goamaan/browser-bridge
npm i -g @goamaan/browser-bridge
```

The installed binary is `browser-bridge`.

## Quick start

Launch Chrome with remote debugging enabled, then attach:

```powershell
chrome.exe --remote-debugging-port=9222
```

```bash
browser-bridge browsers attach --browser-id chrome
browser-bridge pages list --browser chrome
browser-bridge pages alias <targetId> app --browser chrome
browser-bridge snapshot app --browser chrome
browser-bridge screenshot app --browser chrome
```

If you want a clean browser instead of your real Chrome session:

```bash
browser-bridge browsers launch --browser-id managed --url https://example.com
browser-bridge pages list --browser managed
browser-bridge snapshot <targetId> --browser managed
```

## Why browser-bridge

- Raw CDP in live mode, so attach goes straight to Chrome instead of relying on Playwright `connectOverCDP`.
- A long-lived daemon that keeps browser sessions, warmed pages, and aliases stable across commands.
- JSON-first CLI responses and structured error envelopes that are easy for agents to consume.
- A JS/TS SDK that mirrors the high-value part of a Playwright-style page API.
- Managed Chromium fallback for isolated automation or CI smoke testing.

## Common commands

Inspect and resolve pages:

```bash
browser-bridge doctor --browser chrome
browser-bridge pages list --browser chrome
browser-bridge pages resolve app --browser chrome
browser-bridge html app --browser chrome
browser-bridge evaluate app "document.title" --browser chrome
```

Mutate pages:

```bash
browser-bridge fill app "input[name='email']" "test@example.com" --browser chrome
browser-bridge type app "input[name='email']" " more" --browser chrome
browser-bridge insert-text app "already-focused text" --browser chrome
browser-bridge click app "text=Submit" --browser chrome
browser-bridge clickxy app 640 240 --browser chrome
browser-bridge loadall app "text=Load more" --browser chrome
```

Manage browser sessions:

```bash
browser-bridge browsers list
browser-bridge browsers detach --browser-id chrome
browser-bridge daemon status
browser-bridge daemon stop
```

For the full generated command reference, see [docs/cli.md](docs/cli.md).

## SDK

```ts
import { connect } from '@goamaan/browser-bridge-sdk';

const client = await connect();

try {
  await client.attachLive({ browserId: 'chrome' });
  const pages = await client.pages('chrome');
  const page = client.page(pages[0].targetId, 'chrome');
  const snapshot = await page.snapshot();
  console.log(snapshot.nodes.length);
} finally {
  await client.disconnect();
}
```

## Examples

- [examples/alias-tabs.ts](examples/alias-tabs.ts): alias and warm a reusable set of tabs based on configurable URL prefixes
- [examples/status.ts](examples/status.ts): fetch daemon status from the SDK

## Skills

The repository includes a standard Agent Skills skill at `.agents/skills/browser-bridge/` and packages a copy with the CLI.

Install it with:

```bash
browser-bridge skill install --global
browser-bridge skill install --project .
```

## Development

`browser-bridge` uses Bun for local development and npm for publish/auth checks.

```bash
bun install
bun run playwright:install
bun run build
bun run test
```

Useful validation commands:

- `bun run lint`
- `bun run typecheck`
- `bun run docs:generate`
- `bun run skill:sync`
- `bun run skill:validate`
- `bun run smoke:managed`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow and [docs/architecture.md](docs/architecture.md) for the design notes.

## Security and community

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending changes.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in issues, discussions, and pull requests.
- Report sensitive security concerns through [SECURITY.md](SECURITY.md), not public issues.

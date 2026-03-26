# live-browser

`live-browser` is browser automation for development work that starts from the browser you already have open.

It attaches to a real Chrome session over raw CDP, keeps tabs addressable by stable aliases, returns structured JSON for every action, and falls back to managed Chromium when you do want a clean browser.

## Why this exists

Most browser automation stacks optimize for one of these worlds:

- disposable fresh browsers for test runs
- very low-level browser control that leaves orchestration to you
- agent wrappers that are pleasant to demo but awkward to wire into real local development loops

`live-browser` is for a different job:

- you already have the app open
- you are already logged in
- you want an agent to inspect, mutate, recover, and keep going without rediscovering the world every step

That leads to a specific product shape:

- live-first attach to your real browser, not just launched throwaway browsers
- a daemon that keeps sessions warm across commands
- page aliases that survive long agent workflows
- structured results and structured faults instead of prose-heavy terminal output
- recovery logic that retries safe reads but does not silently replay writes

If you are debugging a local app, checking a production tab, or building an agent workflow around an already-authenticated browser session, this is the workflow `live-browser` is built for.

## Install

```bash
bun i -g live-browser
npm i -g live-browser
```

The installed binary is `live-browser`.

## Where it fits

Use `live-browser` when you want:

- real logged-in tabs instead of a separate automation-only browser
- a stable machine contract for agents and scripts
- direct commands for common work like `snapshot`, `html`, `evaluate`, `fill`, `click`, `wait`, and `screenshot`
- a local CLI and skill that are easy to install and keep around

Use managed mode when you want:

- a clean browser for smoke tests or deterministic setup
- no dependency on an existing Chrome session

## Quick start

Launch Chrome with remote debugging enabled, then attach:

```powershell
chrome.exe --remote-debugging-port=9222
```

```bash
live-browser browsers attach --browser-id chrome
live-browser pages list --browser chrome
live-browser pages alias <targetId> app --browser chrome
live-browser snapshot app --browser chrome
live-browser screenshot app --browser chrome
```

If you want a clean browser instead of your real Chrome session:

```bash
live-browser browsers launch --browser-id managed --url https://example.com
live-browser pages list --browser managed
live-browser snapshot <targetId> --browser managed
```

## What makes it different

- Live mode uses raw CDP directly.
  That keeps the attach path small and makes it easier to work with real Chrome tabs.
- The daemon owns session reuse.
  Agents can warm tabs once, keep aliases stable, and avoid reconnect churn between commands.
- The CLI is JSON-first.
  Commands return structured results and structured faults so other tools can consume them without reparsing human text.
- Recovery is built in.
  Safe reads can retry after daemon or transport loss, while mutating actions avoid unsafe automatic replay.
- Managed mode is still available.
  You can switch to a clean Playwright-backed browser when isolation matters more than session reuse.

## Common commands

Inspect and resolve pages:

```bash
live-browser doctor --browser chrome
live-browser pages list --browser chrome
live-browser pages resolve app --browser chrome
live-browser html app --browser chrome
live-browser evaluate app "document.title" --browser chrome
```

Mutate pages:

```bash
live-browser fill app "input[name='email']" "test@example.com" --browser chrome
live-browser type app "input[name='email']" " more" --browser chrome
live-browser insert-text app "already-focused text" --browser chrome
live-browser click app "text=Submit" --browser chrome
live-browser clickxy app 640 240 --browser chrome
live-browser loadall app "text=Load more" --browser chrome
```

Manage browser sessions:

```bash
live-browser browsers list
live-browser browsers detach --browser-id chrome
live-browser daemon status
live-browser daemon stop
```

For the full generated command reference, see [docs/cli.md](docs/cli.md).

## Typical development loop

1. Open your app normally in Chrome and log in.
2. Attach once with `live-browser browsers attach --browser-id chrome`.
3. Alias the tabs you care about with `live-browser pages alias`.
4. Let your agent or script work against those aliases with `snapshot`, `evaluate`, `fill`, `click`, `wait`, and `screenshot`.
5. Use `doctor` when a session looks stale, instead of rebuilding the whole browser context.

## Examples

- [examples/alias-tabs.ts](examples/alias-tabs.ts): repo-local example for aliasing and warming tabs in a workspace checkout
- [examples/status.ts](examples/status.ts): repo-local example for fetching daemon status in a workspace checkout

## Skills

The repository includes a standard Agent Skills skill at `.agents/skills/live-browser/` and packages a copy with the CLI.

Install it with:

```bash
live-browser skill install --global
live-browser skill install --project .
```

## Development

`live-browser` uses Bun for local development and npm for publish/auth checks.

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

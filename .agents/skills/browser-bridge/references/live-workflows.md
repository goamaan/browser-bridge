# Live workflows

## Install or run once

```text
bunx @goamaan/browser-bridge --help
npx @goamaan/browser-bridge --help
```

## Attach to a logged-in Chrome session

```text
browser-bridge browsers attach --browser-id chrome
browser-bridge doctor --browser chrome
browser-bridge pages list --browser chrome
browser-bridge pages resolve "<part-of-url-or-title>" --browser chrome
browser-bridge pages alias <targetId> app --browser chrome
browser-bridge pages warm app --browser chrome
```

## Inspect before mutating

```text
browser-bridge snapshot app --browser chrome
browser-bridge html app --browser chrome
browser-bridge evaluate app "document.title" --browser chrome
browser-bridge network app --browser chrome
```

## Mutate with clear intent

```text
browser-bridge fill app "input[name='search']" "segments" --browser chrome
browser-bridge type app "input[name='search']" " more" --browser chrome
browser-bridge click app "text=Apply" --browser chrome
browser-bridge wait app --text "Updated" --browser chrome
```

## Parity helpers for chrome-cdp-style flows

```text
browser-bridge insert-text app "already-focused text" --browser chrome
browser-bridge clickxy app 640 240 --browser chrome
browser-bridge loadall app "text=Load more" --browser chrome --interval 250
browser-bridge browsers detach --browser-id chrome
```

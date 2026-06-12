# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fuzzy Tab is a **Safari Web Extension** for macOS that provides a fuzzy-search command palette for switching between open browser tabs. It uses keyboard shortcut `Cmd+Shift+K` to open a popup where users type to fuzzy-match tab titles, hostnames, and URLs, then navigate results with arrow keys (or Ctrl+N/Ctrl+P) and Enter. `Cmd+Backspace` closes the selected tab.

## Build, Test & Validate

There are no npm/yarn dependencies and no bundler — the extension's JS/CSS/HTML files are used directly. Validation loop, from the repo root:

```sh
# JS unit tests (fuzzy matching logic) — fast, run these first
node --test "tests/*.test.mjs"

# Swift tests (extension resource/manifest validation)
xcodebuild test -project "Fuzzy Tab.xcodeproj" -scheme "Fuzzy Tab" -only-testing:"Fuzzy TabTests"

# Full build
xcodebuild -project "Fuzzy Tab.xcodeproj" -scheme "Fuzzy Tab" build
```

Note: `node --test tests/` (bare directory) does NOT work — use the glob form above. Add `-derivedDataPath .derived/<name>` to xcodebuild to keep build products out of the global DerivedData.

Icons are generated, not hand-edited: `swift scripts/generate-icons.swift` re-renders every PNG (app icon set, extension icons, host-app status icon) from one CoreGraphics drawing.

Both app and extension targets require **macOS 13.0+** (MV3 service workers need Safari 16.4+). Manual testing requires running the app once, then enabling the extension in Safari Settings → Extensions (allow unsigned extensions in Safari's Develop menu during development).

## Architecture

The project has two targets. The Xcode project uses file-system-synchronized groups, so adding/removing files on disk is enough — no pbxproj edits needed.

### `Fuzzy Tab` (macOS host app)
A minimal Cocoa app that only exists to host the Safari extension. It shows a WKWebView with extension enable/disable status and a button to open Safari settings. The extension bundle identifier is `rvdeguzman.Fuzzy-Tab.Extension`.

- `AppDelegate.swift` — terminates on last window close, opts into secure state restoration
- `ViewController.swift` — checks extension state via `SFSafariExtensionManager`, renders status into a WKWebView
- `Resources/Main.html`, `Script.js`, `Style.css`, `Icon.png` — the status page UI

### `Fuzzy Tab Extension` (Safari Web Extension)
Manifest V3 with `tabs` + `storage` permissions. Keep permissions to exactly that set — a Swift test enforces it.

- **`fuzzy.js`** — pure matching logic as an ES module, no browser/DOM APIs (this is what the Node tests import):
  - `fuzzyScore()` — in-order character matching with bonuses for consecutive runs (+8), word-boundary hits (+12), and shorter strings; indices are UTF-16 positions and astral-safe
  - `scoreTab()` — best match across title, hostname, and full URL; active tabs get +25 (or +10000 with no query, to float to the top)
  - `rankTabs()` — filter → sort (score, then active, then title) → cap at `MAX_RESULTS = 8`
  - `labelWindows()` — "Window N" labels, numbered by ascending window id for stability; current window gets an empty label
  - `matchSegments()` — splits text into matched/unmatched runs for highlighting; walks code points so emoji in titles never shift highlights
- **`popup.js`** — DOM and browser-API layer: hydrates instantly from the cached snapshot (storage → background message → direct `tabs.query` fallback), then refreshes in the background. Keyboard navigation, mouse selection-follow, favicon fallbacks. If activating a tab fails (stale snapshot), it drops the entry and re-renders rather than dying.
- **`background.js`** — service worker that maintains the tab snapshot: listens to all tab/window events, debounces (150 ms) into a refresh, persists to `browser.storage.local` so the popup can render before the worker wakes. Duplicates `getHostname` deliberately — it's a classic (non-module) worker and cannot import `fuzzy.js`.
- **`popup.html` / `popup.css`** — macOS-native command palette: flat surfaces, hairline separators, accent-fill selection, system type ramp, light/dark via `prefers-color-scheme`. The input is a `role="combobox"` with `aria-activedescendant` tracking the selection.
- **`manifest.json`** — MV3; icon paths, popup, shortcut, and permissions are all covered by `Fuzzy TabTests`

## Key Design Details

- All fuzzy matching runs client-side with no external dependencies; keep `fuzzy.js` free of browser/DOM APIs so it stays Node-testable
- The extension uses the `browser.*` API (Safari's WebExtension API), not `chrome.*`
- The popup renders from a possibly-stale snapshot by design (speed over freshness); all snapshot consumers must tolerate dead tab ids
- Tests live in `tests/` (Node, matching logic) and `Fuzzy TabTests/` (Swift Testing, resource integrity). When changing scoring behavior, update the Node tests in the same change — they pin the scoring contract.

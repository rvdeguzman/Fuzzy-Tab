# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fuzzy Tab is a **Safari Web Extension** for macOS that provides a fuzzy-search command palette for switching between open browser tabs. It uses keyboard shortcut `Cmd+Shift+K` to open a popup where users type to fuzzy-match tab titles, hostnames, and URLs, then navigate results with arrow keys and Enter.

## Build & Run

This is an Xcode project (`Fuzzy Tab.xcodeproj`). Build and run via:
- **Xcode**: Open `Fuzzy Tab.xcodeproj`, select the "Fuzzy Tab" scheme, and run (Cmd+R)
- **Command line**: `xcodebuild -project "Fuzzy Tab.xcodeproj" -scheme "Fuzzy Tab" build`

There are no npm/yarn dependencies, no bundler, and no build step for the web extension resources — the JS/CSS/HTML files are used directly.

## Architecture

The project has two targets:

### `Fuzzy Tab` (macOS host app)
A minimal Cocoa app that only exists to host the Safari extension. It shows a WKWebView with extension enable/disable status and a button to open Safari preferences. The extension bundle identifier is `rvdeguzman.Fuzzy-Tab.Extension`.

- `AppDelegate.swift` — standard app delegate, terminates on last window close
- `ViewController.swift` — checks extension state via `SFSafariExtensionManager`, renders status in a WKWebView
- `Resources/Main.html`, `Script.js`, `Style.css` — the host app's status page UI

### `Fuzzy Tab Extension` (Safari Web Extension)
The actual extension, using Manifest V3 with `tabs` permission.

- **`popup.js`** — the core of the extension. Handles all tab searching logic:
  - Loads all tabs across all windows via `browser.tabs.query({})`
  - Implements fuzzy scoring (`fuzzyScore()`) with bonuses for consecutive matches, word boundary matches, and shorter strings
  - `scoreTab()` picks the best match across title, hostname, and full URL
  - Results are capped at `MAX_RESULTS = 8`, sorted by score then active status
  - Keyboard navigation (arrow keys, Enter, Escape) and mouse interaction
  - `highlightMatches()` renders matched characters with `<mark>` tags
- **`popup.html`** / **`popup.css`** — command palette UI with light/dark mode support via CSS custom properties and `prefers-color-scheme`
- **`background.js`** / **`content.js`** — scaffolding from the Xcode template, not actively used
- **`manifest.json`** — Manifest V3, declares `tabs` permission and keyboard shortcut

## Key Design Details

- All fuzzy matching runs client-side in `popup.js` with no external dependencies
- The extension uses the `browser.*` API (Safari's WebExtension API), not `chrome.*`
- Window labels show "This Window" for the current window and "Window N" for others
- Active tabs get a score bonus (+25 in search, +10000 when no query) to float to the top
- Favicons fall back to a styled first-letter span on load error

//
//  fuzzy.test.mjs
//  Unit tests for the extension's pure matching logic.
//
//  Run from the repo root:  node --test tests/
//

import test from "node:test";
import assert from "node:assert/strict";

import {
    MAX_RESULTS,
    fuzzyScore,
    getHostname,
    labelWindows,
    matchSegments,
    rankTabs,
    scoreTab
} from "../Fuzzy Tab Extension/Resources/fuzzy.js";

function makeTab(overrides = {}) {
    return {
        id: 1,
        windowId: 10,
        active: false,
        title: "Example Page",
        url: "https://example.com/page",
        hostname: "example.com",
        favIconUrl: "",
        ...overrides
    };
}

// ── fuzzyScore ─────────────────────────────────────────────

test("fuzzyScore matches characters in order", () => {
    const match = fuzzyScore("github pull requests", "ghpr");
    assert.ok(match);
    assert.deepEqual(match.indices, [0, 3, 7, 12]);
});

test("fuzzyScore returns null when characters are missing", () => {
    assert.equal(fuzzyScore("github", "z"), null);
});

test("fuzzyScore returns null when characters are out of order", () => {
    assert.equal(fuzzyScore("abc", "cb"), null);
});

test("fuzzyScore returns null for empty values", () => {
    assert.equal(fuzzyScore("", "a"), null);
    assert.equal(fuzzyScore(null, "a"), null);
});

test("fuzzyScore rewards consecutive runs over scattered matches", () => {
    const padding = "xyxyxyxyxyxyxyxyxyxyxyxy";
    const consecutive = fuzzyScore(`${padding}abc`, "abc");
    const scattered = fuzzyScore(`${padding}aXbXc`, "abc");
    assert.ok(consecutive.score > scattered.score);
});

test("fuzzyScore rewards word-boundary matches", () => {
    const boundary = fuzzyScore("the lazy dog", "d");
    const interior = fuzzyScore("the lizard ate", "d");
    assert.ok(boundary.score > interior.score);
});

test("fuzzyScore rewards shorter values", () => {
    const short = fuzzyScore("docs", "d");
    const long = fuzzyScore("documentation portal for everything", "d");
    assert.ok(short.score > long.score);
});

test("fuzzyScore is case-insensitive on the value", () => {
    const match = fuzzyScore("GitHub", "gh");
    assert.ok(match);
    assert.deepEqual(match.indices, [0, 3]);
});

test("fuzzyScore tracks indices correctly past astral characters", () => {
    // "🎸" occupies two UTF-16 units, so "g" sits at index 3.
    const match = fuzzyScore("🎸 guitar tabs", "gui");
    assert.ok(match);
    assert.deepEqual(match.indices, [3, 4, 5]);
});

// ── matchSegments ──────────────────────────────────────────

test("matchSegments round-trips the original text", () => {
    const text = "🎸 guitar tabs";
    const segments = matchSegments(text, [3, 4, 5]);
    assert.equal(segments.map((segment) => segment.text).join(""), text);
});

test("matchSegments merges consecutive matched characters into one run", () => {
    const segments = matchSegments("🎸 guitar tabs", [3, 4, 5]);
    assert.deepEqual(segments, [
        { text: "🎸 ", matched: false },
        { text: "gui", matched: true },
        { text: "tar tabs", matched: false }
    ]);
});

test("matchSegments never splits a surrogate pair", () => {
    const segments = matchSegments("a🎸b", [0, 3]);
    assert.deepEqual(segments, [
        { text: "a", matched: true },
        { text: "🎸", matched: false },
        { text: "b", matched: true }
    ]);
});

test("matchSegments with no indices returns a single unmatched run", () => {
    assert.deepEqual(matchSegments("abc", []), [{ text: "abc", matched: false }]);
});

// ── scoreTab ───────────────────────────────────────────────

test("scoreTab with an empty query keeps every tab and boosts the active one", () => {
    const idle = scoreTab(makeTab(), "");
    const active = scoreTab(makeTab({ active: true }), "");
    assert.equal(idle.score, 0);
    assert.ok(active.score > idle.score);
});

test("scoreTab returns null when nothing matches", () => {
    assert.equal(scoreTab(makeTab(), "zzzz"), null);
});

test("scoreTab maps a title match to title highlights", () => {
    const match = scoreTab(makeTab({ title: "Example" }), "example");
    assert.ok(match.titleMatches.length > 0);
    assert.deepEqual(match.urlMatches, []);
    assert.equal(match.urlDisplay, "example.com");
});

test("scoreTab maps a url-only match to url highlights", () => {
    const tab = makeTab({ title: "Dashboard", url: "https://example.com/settings/profile", hostname: "example.com" });
    const match = scoreTab(tab, "settings");
    assert.ok(match);
    assert.deepEqual(match.titleMatches, []);
    assert.equal(match.urlDisplay, tab.url);
    assert.ok(match.urlMatches.length > 0);
});

test("scoreTab gives the active tab a bonus on equal matches", () => {
    const inactive = scoreTab(makeTab(), "example");
    const active = scoreTab(makeTab({ active: true }), "example");
    assert.equal(active.score - inactive.score, 25);
});

// ── rankTabs ───────────────────────────────────────────────

test("rankTabs filters out non-matching tabs", () => {
    const tabs = [
        makeTab({ id: 1, title: "GitHub" }),
        makeTab({ id: 2, title: "Weather" })
    ];
    const ranked = rankTabs(tabs, "gith");
    assert.deepEqual(ranked.map((tab) => tab.id), [1]);
});

test("rankTabs caps results at MAX_RESULTS", () => {
    const tabs = Array.from({ length: MAX_RESULTS + 5 }, (_, index) =>
        makeTab({ id: index, title: `Tab ${index}` })
    );
    assert.equal(rankTabs(tabs, "tab").length, MAX_RESULTS);
});

test("rankTabs floats the active tab to the top with no query", () => {
    const tabs = [
        makeTab({ id: 1, title: "Alpha" }),
        makeTab({ id: 2, title: "Beta", active: true })
    ];
    assert.equal(rankTabs(tabs, "")[0].id, 2);
});

test("rankTabs normalizes the query", () => {
    const tabs = [makeTab({ id: 1, title: "GitHub" })];
    assert.equal(rankTabs(tabs, "  GITHUB  ").length, 1);
});

test("rankTabs breaks score ties by title", () => {
    const tabs = [
        makeTab({ id: 1, title: "bbbb" }),
        makeTab({ id: 2, title: "aaaa" })
    ];
    assert.deepEqual(rankTabs(tabs, "").map((tab) => tab.id), [2, 1]);
});

// ── labelWindows ───────────────────────────────────────────

test("labelWindows leaves the current window unlabeled", () => {
    const tabs = [makeTab({ windowId: 10 }), makeTab({ windowId: 20 })];
    const labeled = labelWindows(tabs, 10);
    assert.equal(labeled[0].windowLabel, "");
    assert.equal(labeled[1].windowLabel, "Window 2");
});

test("labelWindows numbering is stable across tab reordering", () => {
    const tabs = [makeTab({ windowId: 20 }), makeTab({ windowId: 10 })];
    const labeled = labelWindows(tabs, null);
    // Ascending window id, regardless of tab order in the snapshot.
    assert.equal(labeled.find((tab) => tab.windowId === 10).windowLabel, "Window 1");
    assert.equal(labeled.find((tab) => tab.windowId === 20).windowLabel, "Window 2");
});

// ── getHostname ────────────────────────────────────────────

test("getHostname strips the www prefix", () => {
    assert.equal(getHostname("https://www.example.com/path"), "example.com");
});

test("getHostname returns empty string for invalid urls", () => {
    assert.equal(getHostname("not a url"), "");
    assert.equal(getHostname(""), "");
});

//
//  fuzzy.js
//  Fuzzy Tab Extension
//
//  Pure tab-matching logic shared by the popup. Nothing in this module may
//  touch browser APIs or the DOM — it must stay runnable under Node so the
//  test suite (`node --test tests/`) can exercise it directly.
//

export const MAX_RESULTS = 8;

const BOUNDARY_CHARACTERS = new Set(["/", "-", "_", ".", " ", ":"]);

const CONSECUTIVE_BONUS = 8;
const BOUNDARY_BONUS = 12;
const ACTIVE_TAB_QUERY_BONUS = 25;
const ACTIVE_TAB_IDLE_BONUS = 10_000;
const SHORT_VALUE_MAX_BONUS = 30;

/**
 * Scores `value` against a lowercased `query`. Every query character must
 * appear in order; consecutive runs, word-boundary hits, and shorter values
 * score higher. Returns null on no match, otherwise `{ source, score,
 * indices }` where `indices` are UTF-16 start positions of each matched
 * character in `value` (a matched astral character spans two units).
 */
export function fuzzyScore(value, query, source = "title") {
    if (!value) {
        return null;
    }

    const text = value.toLowerCase();
    let score = 0;
    let searchFrom = 0;
    let previousEnd = -1;
    const indices = [];

    for (const character of query) {
        const index = text.indexOf(character, searchFrom);
        if (index === -1) {
            return null;
        }

        indices.push(index);
        score += 1;

        if (index === previousEnd) {
            score += CONSECUTIVE_BONUS;
        }

        if (index === 0 || BOUNDARY_CHARACTERS.has(text[index - 1])) {
            score += BOUNDARY_BONUS;
        }

        previousEnd = index + character.length;
        searchFrom = previousEnd;
    }

    score += Math.max(0, SHORT_VALUE_MAX_BONUS - value.length);

    return { source, score, indices };
}

/**
 * Picks the best match for a tab across its title, hostname, and full URL.
 * `query` must already be trimmed and lowercased (rankTabs does this).
 * Returns null when nothing matches.
 */
export function scoreTab(tab, query) {
    if (!query) {
        return {
            score: tab.active ? ACTIVE_TAB_IDLE_BONUS : 0,
            titleMatches: [],
            urlDisplay: tab.hostname || tab.url,
            urlMatches: []
        };
    }

    const candidates = [
        fuzzyScore(tab.title, query, "title"),
        fuzzyScore(tab.hostname, query, "hostname"),
        fuzzyScore(tab.url, query, "url")
    ].filter(Boolean);

    if (candidates.length === 0) {
        return null;
    }

    const best = candidates.reduce((left, right) => (right.score > left.score ? right : left));

    return {
        score: best.score + (tab.active ? ACTIVE_TAB_QUERY_BONUS : 0),
        titleMatches: best.source === "title" ? best.indices : [],
        urlDisplay: best.source === "url" ? tab.url : tab.hostname || tab.url,
        urlMatches: best.source === "title" ? [] : best.indices
    };
}

/**
 * Filters, scores, and sorts tabs for display. Returns at most `maxResults`
 * tabs, each augmented with its `match`.
 */
export function rankTabs(tabs, rawQuery, maxResults = MAX_RESULTS) {
    const query = (rawQuery ?? "").trim().toLowerCase();

    return tabs
        .map((tab) => ({ ...tab, match: scoreTab(tab, query) }))
        .filter((tab) => tab.match !== null)
        .sort((left, right) => {
            if (right.match.score !== left.match.score) {
                return right.match.score - left.match.score;
            }

            if (left.active !== right.active) {
                return left.active ? -1 : 1;
            }

            return left.title.localeCompare(right.title);
        })
        .slice(0, maxResults);
}

/**
 * Adds a `windowLabel` to each tab: empty for the current window, "Window N"
 * for others. Numbering follows ascending window id so labels stay stable
 * when tab order changes between snapshot refreshes.
 */
export function labelWindows(tabs, currentWindowId) {
    const windowIds = [...new Set(
        tabs.map((tab) => tab.windowId).filter((id) => typeof id === "number")
    )].sort((left, right) => left - right);

    const indexById = new Map(windowIds.map((id, index) => [id, index + 1]));

    return tabs.map((tab) => ({
        ...tab,
        windowLabel: tab.windowId === currentWindowId
            ? ""
            : `Window ${indexById.get(tab.windowId) ?? "?"}`
    }));
}

/**
 * Splits `text` into `{ text, matched }` runs from the UTF-16 `indices`
 * produced by fuzzyScore. Walks code points so astral characters (emoji in
 * tab titles) never split a surrogate pair or shift the highlights.
 */
export function matchSegments(text, indices) {
    const matchStarts = new Set(indices);
    const segments = [];
    let current = null;

    let position = 0;
    while (position < text.length) {
        const codePoint = text.codePointAt(position);
        const length = codePoint > 0xffff ? 2 : 1;
        const chunk = text.slice(position, position + length);
        const matched = matchStarts.has(position);

        if (current && current.matched === matched) {
            current.text += chunk;
        } else {
            current = { text: chunk, matched };
            segments.push(current);
        }

        position += length;
    }

    return segments;
}

/** Hostname without the leading "www.", or "" for unparseable URLs. */
export function getHostname(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

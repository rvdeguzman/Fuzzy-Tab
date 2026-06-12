//
//  popup.js
//  Fuzzy Tab Extension
//
//  Command-palette popup. Renders instantly from the cached tab snapshot
//  (storage → background cache → live query) and refreshes in the
//  background. All matching logic lives in fuzzy.js.
//

import { getHostname, labelWindows, matchSegments, rankTabs } from "./fuzzy.js";

const searchInput = document.querySelector("#tab-search");
const statusNode = document.querySelector("#status");
const resultsNode = document.querySelector("#tab-results");

const TAB_SNAPSHOT_KEY = "tabSnapshot";

let allTabs = [];
let filteredTabs = [];
let selectedIndex = 0;
let currentWindowId = null;

bindEvents();
searchInput.focus();
requestAnimationFrame(() => {
    hydratePopup().catch((error) => {
        console.error("Failed to hydrate popup", error);
        statusNode.textContent = "Could not load tabs.";
    });
});

function bindEvents() {
    searchInput.addEventListener("input", () => {
        selectedIndex = 0;
        renderResults(searchInput.value);
    });

    searchInput.addEventListener("keydown", (event) => {
        if (isMoveDown(event)) {
            event.preventDefault();
            moveSelection(1);
            return;
        }

        if (isMoveUp(event)) {
            event.preventDefault();
            moveSelection(-1);
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const match = filteredTabs[selectedIndex];
            if (match) {
                activateTab(match);
            }
            return;
        }

        if (event.key === "Backspace" && event.metaKey) {
            event.preventDefault();
            const match = filteredTabs[selectedIndex];
            if (match) {
                closeTab(match.id);
            }
            return;
        }

        if (event.key === "Escape") {
            window.close();
        }
    });
}

function isMoveDown(event) {
    return event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey);
}

function isMoveUp(event) {
    return event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey);
}

function moveSelection(delta) {
    if (filteredTabs.length === 0) {
        return;
    }

    selectedIndex = Math.min(Math.max(selectedIndex + delta, 0), filteredTabs.length - 1);
    updateSelection();
}

async function hydratePopup() {
    currentWindowId = await getCurrentWindowId();

    const cachedTabs = await loadCachedTabs();
    if (cachedTabs.length > 0) {
        applyTabs(cachedTabs);
    }

    const snapshot = await requestTabSnapshot();
    if (snapshot.tabs.length > 0 || cachedTabs.length === 0) {
        applyTabs(snapshot.tabs);
    }

    refreshTabsInBackground();
}

function applyTabs(tabs) {
    allTabs = labelWindows(tabs, currentWindowId);
    renderResults(searchInput.value);
}

async function loadCachedTabs() {
    try {
        const stored = await browser.storage.local.get(TAB_SNAPSHOT_KEY);
        return Array.isArray(stored?.[TAB_SNAPSHOT_KEY]) ? stored[TAB_SNAPSHOT_KEY] : [];
    } catch {
        return [];
    }
}

async function requestTabSnapshot() {
    try {
        const response = await browser.runtime.sendMessage({ type: "get-tab-snapshot" });
        return {
            tabs: Array.isArray(response?.tabs) ? response.tabs : []
        };
    } catch {
        return {
            tabs: await queryTabsDirectly()
        };
    }
}

async function refreshTabsInBackground() {
    try {
        const tabs = await browser.runtime.sendMessage({ type: "refresh-tab-snapshot" });
        if (Array.isArray(tabs)) {
            applyTabs(tabs);
        }
    } catch {
        // Keep showing the cached snapshot if the background refresh fails.
    }
}

async function getCurrentWindowId() {
    try {
        const currentWindow = await browser.windows.getCurrent();
        return currentWindow?.id ?? null;
    } catch {
        return null;
    }
}

async function queryTabsDirectly() {
    const tabs = await browser.tabs.query({});
    return tabs
        .filter((tab) => typeof tab.id === "number" && typeof tab.windowId === "number")
        .map((tab) => ({
            id: tab.id,
            windowId: tab.windowId,
            active: Boolean(tab.active),
            title: tab.title || "Untitled Tab",
            url: tab.url || "",
            hostname: getHostname(tab.url),
            favIconUrl: tab.favIconUrl || ""
        }));
}

function renderResults(query) {
    filteredTabs = rankTabs(allTabs, query);
    selectedIndex = Math.min(selectedIndex, Math.max(filteredTabs.length - 1, 0));

    resultsNode.textContent = "";

    if (filteredTabs.length === 0) {
        const hasQuery = query.trim().length > 0;
        statusNode.textContent = hasQuery ? "No Matches" : "No Tabs";
        const emptyState = document.createElement("li");
        emptyState.className = "empty";
        emptyState.textContent = hasQuery
            ? "Try fewer characters or a site name."
            : "Open a few tabs and try again.";
        resultsNode.append(emptyState);
        updateSelection();
        return;
    }

    statusNode.textContent = `Open Tabs — ${filteredTabs.length}`;

    filteredTabs.forEach((tab, index) => {
        resultsNode.append(createResultItem(tab, index));
    });

    updateSelection();
}

function createResultItem(tab, index) {
    const item = document.createElement("li");
    item.className = "result";
    item.id = `tab-option-${index}`;
    item.setAttribute("role", "option");
    item.dataset.index = String(index);

    item.append(createFaviconNode(tab));

    const copy = document.createElement("div");
    copy.className = "tab-copy";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.append(highlightMatches(tab.title, tab.match.titleMatches));

    const meta = document.createElement("div");
    meta.className = "tab-meta";

    if (tab.windowLabel) {
        const windowChip = document.createElement("span");
        windowChip.className = "window-chip";
        windowChip.textContent = tab.windowLabel;
        meta.append(windowChip);
    }

    const url = document.createElement("div");
    url.className = "tab-url";
    url.append(highlightMatches(tab.match.urlDisplay, tab.match.urlMatches));
    meta.append(url);

    copy.append(title, meta);
    item.append(copy);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    if (tab.active) {
        const activeDot = document.createElement("span");
        activeDot.className = "active-dot";
        activeDot.title = "Active tab";
        actions.append(activeDot);
    }

    const closeButton = document.createElement("button");
    closeButton.className = "close-btn";
    closeButton.setAttribute("aria-label", "Close tab");
    closeButton.textContent = "✕";
    closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(tab.id);
    });
    actions.append(closeButton);

    item.append(actions);

    item.addEventListener("mouseenter", () => {
        selectedIndex = index;
        updateSelection();
    });

    item.addEventListener("click", () => {
        activateTab(tab);
    });

    return item;
}

function updateSelection() {
    const items = resultsNode.querySelectorAll(".result");
    items.forEach((item, index) => {
        item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
    });

    const selectedItem = items[selectedIndex];
    if (selectedItem) {
        searchInput.setAttribute("aria-activedescendant", selectedItem.id);
        selectedItem.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
        searchInput.removeAttribute("aria-activedescendant");
    }
}

async function activateTab(tab) {
    try {
        await browser.tabs.update(tab.id, { active: true });
        await browser.windows.update(tab.windowId, { focused: true });
        window.close();
    } catch (error) {
        // The snapshot was stale and the tab is gone: drop it, re-render,
        // and let the background refresh catch the list up.
        console.error("Failed to activate tab", error);
        allTabs = allTabs.filter((candidate) => candidate.id !== tab.id);
        renderResults(searchInput.value);
        refreshTabsInBackground();
    }
}

async function closeTab(tabId) {
    try {
        await browser.tabs.remove(tabId);
    } catch {
        // Tab may have already been closed.
    }
    allTabs = allTabs.filter((tab) => tab.id !== tabId);
    renderResults(searchInput.value);
}

function createFaviconNode(tab) {
    if (tab.favIconUrl) {
        const image = document.createElement("img");
        image.className = "favicon";
        image.alt = "";
        image.src = tab.favIconUrl;
        image.addEventListener("error", () => {
            image.replaceWith(createFallbackFavicon(tab.title));
        }, { once: true });
        return image;
    }

    return createFallbackFavicon(tab.title);
}

function createFallbackFavicon(title) {
    const fallback = document.createElement("span");
    fallback.className = "favicon fallback";
    fallback.textContent = (title || "?").trim().charAt(0).toUpperCase() || "?";
    return fallback;
}

function highlightMatches(text, indices) {
    const fragment = document.createDocumentFragment();

    for (const segment of matchSegments(text, indices)) {
        if (segment.matched) {
            const mark = document.createElement("mark");
            mark.textContent = segment.text;
            fragment.append(mark);
        } else {
            fragment.append(segment.text);
        }
    }

    return fragment;
}

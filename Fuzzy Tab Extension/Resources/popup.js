const searchInput = document.querySelector("#tab-search");
const statusNode = document.querySelector("#status");
const resultsNode = document.querySelector("#tab-results");

const MAX_RESULTS = 8;
const TAB_SNAPSHOT_KEY = "tabSnapshot";

let allTabs = [];
let filteredTabs = [];
let selectedIndex = 0;
let currentWindowId = null;

initialize().catch((error) => {
    console.error("Failed to initialize popup", error);
    statusNode.textContent = "Could not load tabs.";
});

async function initialize() {
    bindEvents();
    searchInput.focus();
    requestAnimationFrame(() => {
        hydratePopup().catch((error) => {
            console.error("Failed to hydrate popup", error);
            statusNode.textContent = "Could not load tabs.";
        });
    });
}

function bindEvents() {
    searchInput.addEventListener("input", () => {
        selectedIndex = 0;
        renderResults(searchInput.value);
    });

    searchInput.addEventListener("keydown", async (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (filteredTabs.length > 0) {
                selectedIndex = Math.min(selectedIndex + 1, filteredTabs.length - 1);
                updateSelection();
            }
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (filteredTabs.length > 0) {
                selectedIndex = Math.max(selectedIndex - 1, 0);
                updateSelection();
            }
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const match = filteredTabs[selectedIndex];
            if (match) {
                await activateTab(match.id, match.windowId);
            }
        }

        if (event.key === "Backspace" && event.metaKey) {
            event.preventDefault();
            const match = filteredTabs[selectedIndex];
            if (match) {
                await closeTab(match.id);
            }
        }

        if (event.key === "Escape") {
            window.close();
        }
    });
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
    const orderedWindowIds = [...new Set(tabs.map((tab) => tab.windowId).filter((windowId) => typeof windowId === "number"))];
    const windowIndexById = new Map(
        orderedWindowIds.map((windowId, index) => [windowId, index + 1])
    );

    allTabs = tabs.map((tab) => ({
        ...tab,
        windowLabel: tab.windowId === currentWindowId
            ? ""
            : `Window ${windowIndexById.get(tab.windowId) ?? "?"}`
    }));

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
    const normalizedQuery = query.trim().toLowerCase();

    filteredTabs = allTabs
        .map((tab) => ({
            ...tab,
            match: scoreTab(tab, normalizedQuery)
        }))
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
        .slice(0, MAX_RESULTS);

    selectedIndex = Math.min(selectedIndex, Math.max(filteredTabs.length - 1, 0));

    resultsNode.textContent = "";

    if (filteredTabs.length === 0) {
        statusNode.textContent = normalizedQuery ? "No tabs match that search." : "No tabs found.";
        const emptyState = document.createElement("li");
        emptyState.className = "empty";
        emptyState.textContent = normalizedQuery ? "Try fewer characters or a site name." : "Open a few tabs and try again.";
        resultsNode.append(emptyState);
        return;
    }

    statusNode.textContent = `${filteredTabs.length} tab${filteredTabs.length === 1 ? "" : "s"}`;

    filteredTabs.forEach((tab, index) => {
        const item = document.createElement("li");
        item.className = "result";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
        item.dataset.index = String(index);

        item.append(createFaviconNode(tab));

        const copy = document.createElement("div");
        copy.className = "tab-copy";

        const title = document.createElement("div");
        title.className = "tab-title";
        title.append(highlightMatches(tab.title, tab.match.titleMatches));

        const url = document.createElement("div");
        url.className = "tab-url";
        url.append(highlightMatches(tab.match.urlDisplay, tab.match.urlMatches));

        const meta = document.createElement("div");
        meta.className = "tab-meta";

        if (tab.windowLabel) {
            const windowChip = document.createElement("span");
            windowChip.className = "window-chip";
            windowChip.textContent = tab.windowLabel;
            meta.append(windowChip);
        }

        meta.append(url);
        copy.append(title, meta);
        item.append(copy);

        const actions = document.createElement("div");
        actions.className = "result-actions";

        if (tab.active) {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = "Active";
            actions.append(badge);
        }

        const closeBtn = document.createElement("button");
        closeBtn.className = "close-btn";
        closeBtn.setAttribute("aria-label", "Close tab");
        closeBtn.textContent = "\u2715";
        closeBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await closeTab(tab.id);
        });
        actions.append(closeBtn);

        item.append(actions);

        item.addEventListener("mouseenter", () => {
            selectedIndex = index;
            updateSelection();
        });

        item.addEventListener("click", async () => {
            await activateTab(tab.id, tab.windowId);
        });

        resultsNode.append(item);
    });

    updateSelection();
}

function updateSelection() {
    const items = resultsNode.querySelectorAll(".result");
    items.forEach((item, index) => {
        item.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
    });

    const selectedItem = items[selectedIndex];
    if (selectedItem) {
        selectedItem.scrollIntoView({
            block: "nearest",
            inline: "nearest"
        });
    }
}

async function activateTab(tabId, windowId) {
    await browser.tabs.update(tabId, { active: true });
    await browser.windows.update(windowId, { focused: true });
    window.close();
}

async function closeTab(tabId) {
    try {
        await browser.tabs.remove(tabId);
    } catch {
        // Tab may have already been closed
    }
    allTabs = allTabs.filter((tab) => tab.id !== tabId);
    renderResults(searchInput.value);
}

function scoreTab(tab, query) {
    if (!query) {
        return {
            score: tab.active ? 10_000 : 0,
            titleMatches: [],
            urlDisplay: tab.hostname || tab.url,
            urlMatches: []
        };
    }

    const titleScore = fuzzyScore(tab.title, query);
    const hostScore = fuzzyScore(tab.hostname, query, "hostname");
    const urlScore = fuzzyScore(tab.url, query, "url");

    const candidates = [titleScore, hostScore, urlScore].filter(Boolean);
    if (candidates.length === 0) {
        return null;
    }

    const best = candidates.sort((left, right) => right.score - left.score)[0];

    return {
        score: best.score + (tab.active ? 25 : 0),
        titleMatches: best.source === "title" ? best.indices : [],
        urlDisplay: best.source === "url" ? tab.url : tab.hostname || tab.url,
        urlMatches: best.source === "hostname" || best.source === "url" ? best.indices : []
    };
}

function fuzzyScore(value, query, source = "title") {
    if (!value) {
        return null;
    }

    const text = value.toLowerCase();
    let score = 0;
    let previousIndex = -1;
    const indices = [];

    for (const character of query) {
        const index = text.indexOf(character, previousIndex + 1);
        if (index === -1) {
            return null;
        }

        indices.push(index);
        score += 1;

        if (index === previousIndex + 1) {
            score += 8;
        }

        if (index === 0 || isBoundaryCharacter(text[index - 1])) {
            score += 12;
        }

        previousIndex = index;
    }

    score += Math.max(0, 30 - value.length);

    return {
        source,
        score,
        indices
    };
}

function isBoundaryCharacter(character) {
    return ["/", "-", "_", ".", " ", ":"].includes(character);
}

function getHostname(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
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
    const uniqueIndices = new Set(indices);

    for (const [index, character] of Array.from(text).entries()) {
        if (uniqueIndices.has(index)) {
            const mark = document.createElement("mark");
            mark.textContent = character;
            fragment.append(mark);
        } else {
            fragment.append(character);
        }
    }

    return fragment;
}

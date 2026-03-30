const SNAPSHOT_STORAGE_KEY = "tabSnapshot";

let cachedTabs = [];
let refreshTimer = null;
let refreshInFlight = null;

initialize().catch((error) => {
    console.error("Failed to initialize background cache", error);
});

browser.runtime.onMessage.addListener((message = {}) => {
    if (message.type === "get-tab-snapshot") {
        return getSnapshot();
    }

    if (message.type === "refresh-tab-snapshot") {
        return refreshTabs();
    }

    return undefined;
});

browser.tabs.onCreated.addListener(() => {
    scheduleRefresh();
});

browser.tabs.onRemoved.addListener(() => {
    scheduleRefresh();
});

browser.tabs.onDetached.addListener(() => {
    scheduleRefresh();
});

browser.tabs.onAttached.addListener(() => {
    scheduleRefresh();
});

browser.tabs.onMoved.addListener(() => {
    scheduleRefresh();
});

browser.tabs.onActivated.addListener(() => {
    scheduleRefresh();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.title || changeInfo.url || changeInfo.status || changeInfo.favIconUrl) {
        scheduleRefresh();
    }
});

browser.windows.onRemoved.addListener(() => {
    scheduleRefresh();
});

if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => {
        scheduleRefresh(0);
    });
}

if (browser.runtime.onInstalled) {
    browser.runtime.onInstalled.addListener(() => {
        scheduleRefresh(0);
    });
}

async function initialize() {
    await loadCachedTabs();
    scheduleRefresh(0);
}

async function getSnapshot() {
    if (cachedTabs.length > 0) {
        return { tabs: cachedTabs, stale: false };
    }

    await loadCachedTabs();
    if (cachedTabs.length > 0) {
        return { tabs: cachedTabs, stale: true };
    }

    const tabs = await refreshTabs();
    return { tabs, stale: false };
}

async function loadCachedTabs() {
    const stored = await browser.storage.local.get(SNAPSHOT_STORAGE_KEY);
    const snapshot = stored?.[SNAPSHOT_STORAGE_KEY];
    if (Array.isArray(snapshot)) {
        cachedTabs = snapshot;
    }
}

function scheduleRefresh(delay = 150) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshTabs().catch((error) => {
            console.error("Failed to refresh tab cache", error);
        });
    }, delay);
}

async function refreshTabs() {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = (async () => {
        const tabs = await browser.tabs.query({});
        cachedTabs = tabs
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

        await browser.storage.local.set({ [SNAPSHOT_STORAGE_KEY]: cachedTabs });
        return cachedTabs;
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
}

function getHostname(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "";
    }
}

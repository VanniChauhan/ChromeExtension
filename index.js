"use strict";

/**
  URL Saver — popup script
 
  SECURITY NOTES :
  1. We NEVER used innerHTML / insertAdjacentHTML with data that came from a
     tab or from storage. Every dynamic value is inserted with textContent
     or a DOM property, so it is always treated as plain text, never markup
     or script. This is what stops "DOM-based XSS".
  2. We validate every URL with `new URL(...)` and only accept http/https
     before it's ever stored or displayed. This blocks javascript:, data:,
     file: and other schemes that could otherwise do something surprising
     if a link were ever clicked or rendered unsafely.
  3. We use chrome.storage (not localStorage). Extension storage is
     sandboxed per-extension and isn't reachable by web pages.
  4. We never alert() — blocking dialogs are poor UX and, in MV3 popups,
     can behave inconsistently. We use a non-blocking toast instead.
  5. No remote code is loaded (no CDN scripts). Manifest V3 and the Chrome
     Web Store review process disallow remotely-hosted code; every script
     that runs here ships inside the extension package.
 */

const els = {
  saveBtn: document.getElementById("save-btn"),
  saveLabel: document.querySelector(".save-btn__label"),
  list: document.getElementById("list"),
  emptyState: document.getElementById("empty-state"),
  toast: document.getElementById("toast"),
  searchInput: document.getElementById("search-input"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsMenu: document.getElementById("settings-menu"),
  storageToggle: document.getElementById("storage-toggle"),
  storageToggleLabel: document.getElementById("storage-toggle-label"),
  exportBtn: document.getElementById("export-btn"),
  clearAllBtn: document.getElementById("clear-all-btn"),
};

let toastTimer = null;
let currentFilter = "";

// Which storage area the user wants: "local" (default, higher quota,
// stays on this device) or "sync" (small quota, follows the Chrome
// profile across devices). We remember the choice in storage.local
// itself so the preference always survives even if the user is
// currently pointed at "sync".
function getStorageAreaName() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["storageArea"], (result) => {
      resolve(result.storageArea === "sync" ? "sync" : "local");
    });
  });
}

function getStorageArea(name) {
  return name === "sync" ? chrome.storage.sync : chrome.storage.local;
}

function getSavedUrls() {
  return getStorageAreaName().then(
    (areaName) =>
      new Promise((resolve) => {
        getStorageArea(areaName).get(["savedUrls"], (result) => {
          if (chrome.runtime.lastError) {
            resolve([]);
            return;
          }
          resolve(Array.isArray(result.savedUrls) ? result.savedUrls : []);
        });
      }),
  );
}

function setSavedUrls(urls) {
  return getStorageAreaName().then(
    (areaName) =>
      new Promise((resolve, reject) => {
        getStorageArea(areaName).set({ savedUrls: urls }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message);
            return;
          }
          resolve();
        });
      }),
  );
}

// Only ever accept http/https. This is the single most important
// security check in this file: it stops us from ever storing or
// rendering a javascript:, data:, or chrome:// URL that could behave
// unexpectedly if it were later opened or displayed.
function toSafeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function renderList(urls) {
  els.list.textContent = ""; // clear safely

  const filtered = urls.filter((u) =>
    u.toLowerCase().includes(currentFilter.toLowerCase()),
  );

  els.emptyState.hidden = urls.length !== 0;

  if (urls.length !== 0 && filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "item";
    li.style.color = "var(--text-muted)";
    li.style.fontSize = "12px";
    li.style.justifyContent = "center";
    li.textContent = "No links match your search.";
    els.list.appendChild(li);
    return;
  }

  filtered.forEach((rawUrl) => {
    const safe = toSafeUrl(rawUrl);
    if (!safe) return; // skip anything that no longer validates

    const li = document.createElement("li");
    li.className = "item";
    li.dataset.url = rawUrl;

    const favicon = document.createElement("img");
    favicon.className = "item__favicon";
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    // Chrome's favicon service for the extension's own installed pages.
    // Falls back to a blank box (via CSS background) if it 404s.
    favicon.src = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(
      safe.hostname,
    )}`;
    favicon.onerror = () => {
      favicon.style.visibility = "hidden";
    };

    const textWrap = document.createElement("div");
    textWrap.className = "item__text";

    const domainEl = document.createElement("span");
    domainEl.className = "item__domain";
    domainEl.textContent = safe.hostname; // textContent = safe from markup injection

    const pathEl = document.createElement("span");
    pathEl.className = "item__path";
    const pathText = safe.pathname + safe.search;
    pathEl.textContent = pathText.length > 1 ? pathText : safe.href;

    textWrap.appendChild(domainEl);
    textWrap.appendChild(pathEl);

    const actions = document.createElement("div");
    actions.className = "item__actions";

    const openBtn = makeIconButton("Open link", iconOpen());
    openBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: safe.href });
    });

    const copyBtn = makeIconButton("Copy link", iconCopy());
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(safe.href);
        showToast("Copied to clipboard");
      } catch {
        showToast("Could not copy link", true);
      }
    });

    const deleteBtn = makeIconButton("Delete link", iconTrash());
    deleteBtn.addEventListener("click", () => handleDelete(rawUrl, li));

    actions.appendChild(openBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(favicon);
    li.appendChild(textWrap);
    li.appendChild(actions);
    els.list.appendChild(li);
  });
}

function makeIconButton(label, svgEl) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.setAttribute("aria-label", label);
  btn.appendChild(svgEl);
  return btn;
}

// Small inline icon builders (kept as DOM nodes, not string HTML)
function svg(pathData, viewBox = "0 0 24 24") {
  const ns = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(ns, "svg");
  svgEl.setAttribute("viewBox", viewBox);
  svgEl.setAttribute("width", "14");
  svgEl.setAttribute("height", "14");
  svgEl.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svgEl.appendChild(path);
  return svgEl;
}

function iconOpen() {
  return svg(
    "M14 5h5v5M19 5l-9 9M9 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-3",
  );
}
function iconCopy() {
  return svg("M8 8h10v10H8zM6 16H5a1 1 0 01-1-1V6a1 1 0 011-1h9a1 1 0 011 1v1");
}
function iconTrash() {
  return svg(
    "M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12",
  );
}


function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message; // textContent only — never markup
  els.toast.classList.toggle("toast--error", isError);
  els.toast.hidden = false;
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 1800);
}

async function handleSave() {
  els.saveBtn.disabled = true; // prevent double-clicks / duplicate writes

  try {
    // activeTab permission only grants us the tab's info because the
    // user just clicked the extension's own action button — not on a
    // timer, not in the background. This is the least-privileged way
    // to read "what tab is open right now".
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve),
    );
    const rawUrl = tabs && tabs[0] && tabs[0].url;

    if (!rawUrl) {
      showToast("Could not read the current tab's URL", true);
      return;
    }

    const safe = toSafeUrl(rawUrl);
    if (!safe) {
      showToast("This page can't be saved (unsupported URL type)", true);
      return;
    }

    const urls = await getSavedUrls();
    if (urls.includes(safe.href)) {
      showToast("Already saved");
      return;
    }

    const updated = [...urls, safe.href];

    try {
      await setSavedUrls(updated);
    } catch (err) {
      // Most likely cause: chrome.storage.sync's small quota (~100KB
      // total, single items limited too). Tell the user in plain
      // language instead of failing silently or throwing a raw error.
      showToast(
        "Storage limit reached — try switching to Local in settings",
        true,
      );
      return;
    }

    renderList(updated);
    flashSaved();
  } catch (err) {
    showToast("Something went wrong saving this link", true);
  } finally {
    els.saveBtn.disabled = false;
  }
}

function flashSaved() {
  els.saveBtn.classList.add("is-saved");
  const original = els.saveLabel.textContent;
  els.saveLabel.textContent = "Saved";
  showToast("Link saved");
  setTimeout(() => {
    els.saveBtn.classList.remove("is-saved");
    els.saveLabel.textContent = original;
  }, 1500);
}


async function handleDelete(rawUrl, listItemEl) {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const finish = async () => {
    const urls = await getSavedUrls();
    const updated = urls.filter((u) => u !== rawUrl);
    try {
      await setSavedUrls(updated);
    } catch {
      showToast("Could not delete — storage error", true);
      renderList(urls);
      return;
    }
    renderList(updated);
  };

  if (prefersReducedMotion) {
    await finish();
    return;
  }

  listItemEl.classList.add("is-removing");
  listItemEl.addEventListener(
    "animationend",
    () => {
      finish();
    },
    { once: true },
  );
}

function closeSettingsMenu() {
  els.settingsMenu.hidden = true;
  els.settingsBtn.setAttribute("aria-expanded", "false");
}

els.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !els.settingsMenu.hidden;
  els.settingsMenu.hidden = isOpen;
  els.settingsBtn.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (e) => {
  if (!els.settingsMenu.hidden && !els.settingsMenu.contains(e.target)) {
    closeSettingsMenu();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettingsMenu();
});

els.storageToggle.addEventListener("click", async () => {
  const current = await getStorageAreaName();
  const next = current === "local" ? "sync" : "local";

  chrome.storage.local.set({ storageArea: next }, async () => {
    els.storageToggleLabel.textContent = `Storage: ${
      next === "local" ? "Local" : "Synced"
    }`;
    els.storageToggle.setAttribute("aria-checked", String(next === "sync"));
    const urls = await getSavedUrls();
    renderList(urls);
    showToast(
      next === "sync"
        ? "Now syncing across signed-in devices"
        : "Now storing only on this device",
    );
  });
});

els.exportBtn.addEventListener("click", async () => {
  const urls = await getSavedUrls();
  const blob = new Blob([JSON.stringify(urls, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  // Use a plain <a download> instead of the chrome.downloads API so we
  // don't need to request the extra "downloads" permission — one less
  // permission prompt, one smaller attack surface.
  const a = document.createElement("a");
  a.href = url;
  a.download = "url-saver-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  closeSettingsMenu();
});

els.clearAllBtn.addEventListener("click", async () => {
  try {
    await setSavedUrls([]);
    renderList([]);
    showToast("All links deleted");
  } catch {
    showToast("Could not clear links", true);
  }
  closeSettingsMenu();
});


let searchDebounce = null;
els.searchInput.addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const value = e.target.value;
  searchDebounce = setTimeout(async () => {
    currentFilter = value;
    const urls = await getSavedUrls();
    renderList(urls);
  }, 120);
});

els.saveBtn.addEventListener("click", handleSave);

(async function init() {
  const areaName = await getStorageAreaName();
  els.storageToggleLabel.textContent = `Storage: ${
    areaName === "local" ? "Local" : "Synced"
  }`;
  els.storageToggle.setAttribute("aria-checked", String(areaName === "sync"));

  const urls = await getSavedUrls();
  renderList(urls);
})();

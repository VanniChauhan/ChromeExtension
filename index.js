"use strict";

/**
 * URL Saver — popup script
 *
 * SECURITY NOTES (read these — they matter more than the features):
 * 1. We NEVER use innerHTML / insertAdjacentHTML with data that came from a
 *    tab or from storage. Every dynamic value is inserted with textContent
 *    or a DOM property, so it is always treated as plain text, never markup
 *    or script. This is what stops "DOM-based XSS".
 * 2. We validate every URL with `new URL(...)` and only accept http/https
 *    before it's ever stored or displayed. This blocks javascript:, data:,
 *    file: and other schemes that could otherwise do something surprising
 *    if a link were ever clicked or rendered unsafely.
 * 3. We use chrome.storage (not localStorage). Extension storage is
 *    sandboxed per-extension and isn't reachable by web pages.
 * 4. We never alert() — blocking dialogs are poor UX and, in MV3 popups,
 *    can behave inconsistently. We use a non-blocking toast instead.
 * 5. No remote code is loaded. GSAP is bundled locally at vendor/gsap.min.js
 *    instead of pulled from a CDN — Manifest V3 disallows remotely-hosted
 *    code, and a local file means one less network dependency to trust.
 */

/* ------------------------------------------------------------------ */
/* Standalone preview shim                                              */
/* ------------------------------------------------------------------ */
// If this file is opened directly as a plain HTML file (double-clicked,
// or previewed in a normal browser tab) there is no `chrome` global at
// all — this is NOT the extension running, just the raw file. Rather
// than crash, we detect that and swap in a small in-memory shim with
// sample data, purely so the UI can be previewed. The real extension
// (loaded via chrome://extensions → "Load unpacked") always uses the
// real chrome.storage / chrome.tabs APIs untouched below.
const isRealExtensionContext =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.id &&
  chrome.storage &&
  chrome.tabs;

if (!isRealExtensionContext) {
  const sampleUrls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://github.com/anthropics/anthropic-sdk-typescript",
    "https://twitter.com/anthropicai",
    "https://www.amazon.com/dp/B0C1234567",
    "https://medium.com/@writer/an-essay-about-focus",
    "https://docs.google.com/document/d/abc123",
  ];
  let demoStore = { savedUrls: sampleUrls.slice(), storageArea: "local" };
  let tabIndex = 0;
  const extraSamples = [
    "https://www.google.com/search?q=chrome+extensions",
    "https://www.reddit.com/r/webdev",
    "https://stackoverflow.com/questions/12345/example",
    "https://www.notion.so/example-page",
    "https://www.bbc.co.uk/news/example",
  ];

  const fakeArea = {
    get(_keys, cb) {
      setTimeout(() => cb({ ...demoStore }), 60);
    },
    set(obj, cb) {
      setTimeout(() => {
        Object.assign(demoStore, obj);
        if (cb) cb();
      }, 60);
    },
  };

  window.chrome = {
    runtime: { lastError: null, id: "demo" },
    storage: { local: fakeArea, sync: fakeArea },
    tabs: {
      query(_opts, cb) {
        const url = extraSamples[tabIndex % extraSamples.length];
        tabIndex += 1;
        setTimeout(() => cb([{ url }]), 30);
      },
      create(opts) {
        window.open(opts.url, "_blank", "noopener,noreferrer");
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Category heuristics (a stand-in for the future AI classifier)       */
/* ------------------------------------------------------------------ */
// This is a plain hostname-matching heuristic, not AI. It's written as
// a self-contained lookup specifically so it's a one-line swap later:
// replace the body of `categorize()` with a call to a real classifier
// and every other part of the UI (orbit nodes, list grouping, counts)
// keeps working unchanged.
const CATEGORIES = [
  {
    id: "video",
    label: "Video",
    icon: "▶",
    var: "--cat-video",
    test: (h) =>
      /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)$/.test(h),
  },
  {
    id: "social",
    label: "Social",
    icon: "@",
    var: "--cat-social",
    test: (h) =>
      /(^|\.)(twitter\.com|x\.com|instagram\.com|facebook\.com|reddit\.com|linkedin\.com|threads\.net)$/.test(
        h,
      ),
  },
  {
    id: "docs",
    label: "Docs & Dev",
    icon: "{ }",
    var: "--cat-docs",
    test: (h) =>
      /(^|\.)(docs\.google\.com|drive\.google\.com|notion\.so|github\.com|gitlab\.com|stackoverflow\.com)$/.test(
        h,
      ),
  },
  {
    id: "shopping",
    label: "Shopping",
    icon: "$",
    var: "--cat-shopping",
    test: (h) =>
      /(^|\.)(amazon\.[a-z.]+|ebay\.[a-z.]+|etsy\.com|flipkart\.com)$/.test(h),
  },
  {
    id: "reading",
    label: "Reading",
    icon: "≡",
    var: "--cat-reading",
    test: (h) =>
      /(^|\.)(medium\.com|substack\.com|nytimes\.com|bbc\.co\.uk|wikipedia\.org)$/.test(
        h,
      ),
  },
  {
    id: "search",
    label: "Search",
    icon: "⌕",
    var: "--cat-search",
    test: (h) => /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(h),
  },
];
const GENERAL_CATEGORY = {
  id: "general",
  label: "General",
  icon: "●",
  var: "--cat-general",
  test: () => true,
};

function categorize(hostname) {
  const h = hostname.replace(/^www\./, "");
  return CATEGORIES.find((c) => c.test(h)) || GENERAL_CATEGORY;
}

function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || GENERAL_CATEGORY;
}

/* ------------------------------------------------------------------ */
/* DOM references                                                       */
/* ------------------------------------------------------------------ */

const els = {
  saveBtn: document.getElementById("save-btn"),
  saveLabel: document.querySelector(".save-btn__label"),
  toast: document.getElementById("toast"),
  searchInput: document.getElementById("search-input"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsMenu: document.getElementById("settings-menu"),
  storageToggle: document.getElementById("storage-toggle"),
  storageToggleLabel: document.getElementById("storage-toggle-label"),
  exportBtn: document.getElementById("export-btn"),
  clearAllBtn: document.getElementById("clear-all-btn"),
  previewBadge: document.getElementById("preview-badge"),

  orbitView: document.getElementById("orbit-view"),
  orbitStage: document.getElementById("orbit-stage"),
  orbitHub: document.getElementById("orbit-hub"),
  orbitHubCount: document.getElementById("orbit-hub-count"),

  listView: document.getElementById("list-view"),
  list: document.getElementById("list"),
  emptyState: document.getElementById("empty-state"),
  backBtn: document.getElementById("back-to-orbit-btn"),
  listViewTitle: document.getElementById("list-view-title"),
  viewToggleBtn: document.getElementById("view-toggle-btn"),
};

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  view: "orbit", // "orbit" | "list"
  activeCategory: null, // null = "all"
  searchAutoSwitched: false,
  toastTimer: null,
};

/* ------------------------------------------------------------------ */
/* Storage helpers                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* URL validation                                                        */
/* ------------------------------------------------------------------ */

// Only ever accept http/https. This is the single most important
// security check in this file — it stops us from ever storing or
// rendering a javascript:, data:, or chrome:// URL.
function toSafeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Grouping                                                              */
/* ------------------------------------------------------------------ */

function groupByCategory(urls) {
  const groups = new Map(); // id -> { category, urls: [] }
  urls.forEach((rawUrl) => {
    const safe = toSafeUrl(rawUrl);
    if (!safe) return;
    const cat = categorize(safe.hostname);
    if (!groups.has(cat.id)) groups.set(cat.id, { category: cat, urls: [] });
    groups.get(cat.id).urls.push(rawUrl);
  });
  return groups;
}

/* ------------------------------------------------------------------ */
/* Orbit view rendering                                                  */
/* ------------------------------------------------------------------ */

function clearOrbitNodes() {
  els.orbitStage.querySelectorAll(".orbit-node").forEach((n) => n.remove());
}

function renderOrbit(urls) {
  const groups = Array.from(groupByCategory(urls).values());
  els.orbitHubCount.textContent = String(urls.length);
  els.orbitView.classList.toggle("is-empty", urls.length === 0);
  clearOrbitNodes();
  if (urls.length === 0) return;

  const stageW = els.orbitStage.clientWidth || 380;
  const stageH = els.orbitStage.clientHeight || 240;
  const cx = stageW / 2;
  const cy = stageH / 2;
  const R = 80;
  const startAngle = -Math.PI / 2;
  const step = (2 * Math.PI) / groups.length;

  const nodes = groups.map((group, i) => {
    const angle = startAngle + i * step;
    const x = cx + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    return { group, x, y };
  });

  nodes.forEach(({ group, x, y }) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "orbit-node";
    node.style.setProperty("--node-color", `var(${group.category.var})`);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.dataset.category = group.category.id;
    node.setAttribute(
      "aria-label",
      `${group.category.label}, ${group.urls.length} saved link${group.urls.length === 1 ? "" : "s"}`,
    );

    const icon = document.createElement("span");
    icon.className = "orbit-node__icon";
    icon.textContent = group.category.icon;

    const label = document.createElement("span");
    label.className = "orbit-node__label";
    label.textContent = group.category.label;

    const badge = document.createElement("span");
    badge.className = "orbit-node__badge";
    badge.style.setProperty("--node-color", `var(${group.category.var})`);
    badge.textContent = String(group.urls.length);

    node.appendChild(icon);
    node.appendChild(label);
    node.appendChild(badge);
    node.addEventListener("click", () => openCategory(group.category.id));

    els.orbitStage.appendChild(node);
  });

  animateOrbitEntrance();
}

function animateOrbitEntrance() {
  const nodes = els.orbitStage.querySelectorAll(".orbit-node");
  if (prefersReducedMotion() || typeof gsap === "undefined") {
    nodes.forEach((n) => (n.style.opacity = "1"));
    return;
  }
  gsap.fromTo(
    nodes,
    { opacity: 0, scale: 0.3 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.45,
      ease: "back.out(2)",
      stagger: 0.06,
    },
  );
  // A slow, gentle ambient float — purely decorative, and skipped
  // entirely under prefers-reduced-motion above.
  gsap.to(nodes, {
    y: "+=5",
    duration: 2.2,
    ease: "sine.inOut",
    yoyo: true,
    repeat: -1,
    stagger: { each: 0.15, from: "random" },
  });
}

/* ------------------------------------------------------------------ */
/* List view rendering                                                   */
/* ------------------------------------------------------------------ */

function currentFilterText() {
  return els.searchInput.value.trim().toLowerCase();
}

function renderList(urls) {
  let scoped = urls;
  if (state.activeCategory) {
    scoped = urls.filter((rawUrl) => {
      const safe = toSafeUrl(rawUrl);
      return safe && categorize(safe.hostname).id === state.activeCategory;
    });
  }

  const filterText = currentFilterText();
  const filtered = filterText
    ? scoped.filter((u) => u.toLowerCase().includes(filterText))
    : scoped;

  els.listViewTitle.textContent = state.activeCategory
    ? categoryById(state.activeCategory).label
    : "All links";

  els.list.textContent = ""; // clear safely, never via innerHTML

  const nothingToShow = filtered.length === 0;
  els.emptyState.hidden = !nothingToShow;
  els.emptyState.querySelector(".empty-state__hint").textContent = filterText
    ? "No links match your search."
    : "Saved links in this category will show up here.";

  filtered.forEach((rawUrl) => {
    const safe = toSafeUrl(rawUrl);
    if (!safe) return;
    const cat = categorize(safe.hostname);

    const li = document.createElement("li");
    li.className = "item";
    li.dataset.url = rawUrl;

    const dot = document.createElement("span");
    dot.className = "item__dot";
    dot.style.setProperty("--node-color", `var(${cat.var})`);

    const favicon = document.createElement("img");
    favicon.className = "item__favicon";
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    favicon.src = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(safe.hostname)}`;
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
    openBtn.addEventListener("click", () =>
      chrome.tabs.create({ url: safe.href }),
    );

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

    li.appendChild(dot);
    li.appendChild(favicon);
    li.appendChild(textWrap);
    li.appendChild(actions);
    els.list.appendChild(li);

    if (!prefersReducedMotion() && typeof gsap !== "undefined") {
      gsap.fromTo(
        li,
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.28, ease: "power2.out" },
      );
    }
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

function svg(pathData) {
  const ns = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(ns, "svg");
  svgEl.setAttribute("viewBox", "0 0 24 24");
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

/* ------------------------------------------------------------------ */
/* View switching                                                        */
/* ------------------------------------------------------------------ */

async function refreshCurrentView() {
  const urls = await getSavedUrls();
  if (state.view === "orbit") {
    renderOrbit(urls);
  } else {
    renderList(urls);
  }
}

function setView(view) {
  state.view = view;
  els.orbitView.hidden = view !== "orbit";
  els.listView.hidden = view !== "list";
  els.viewToggleBtn.setAttribute(
    "aria-label",
    view === "orbit" ? "Switch to list view" : "Switch to orbit view",
  );
  refreshCurrentView();
}

function openCategory(categoryId) {
  state.activeCategory = categoryId;
  setView("list");
}

els.orbitHub.addEventListener("click", () => openCategory(null));
els.backBtn.addEventListener("click", () => {
  state.activeCategory = null;
  els.searchInput.value = "";
  setView("orbit");
});

els.viewToggleBtn.addEventListener("click", () => {
  if (state.view === "orbit") {
    state.activeCategory = null;
    setView("list");
  } else {
    setView("orbit");
  }
});

/* ------------------------------------------------------------------ */
/* Toast                                                                 */
/* ------------------------------------------------------------------ */

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message; // textContent only — never markup
  els.toast.classList.toggle("toast--error", isError);
  els.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 1800);
}

/* ------------------------------------------------------------------ */
/* Save flow (with the orbit "flight" animation)                        */
/* ------------------------------------------------------------------ */

function flyDot(fromEl, toEl, onComplete) {
  if (
    prefersReducedMotion() ||
    typeof gsap === "undefined" ||
    !fromEl ||
    !toEl
  ) {
    onComplete();
    return;
  }
  const from = fromEl.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();
  const dot = document.createElement("div");
  dot.className = "flight-dot";
  dot.style.left = `${from.left + from.width / 2}px`;
  dot.style.top = `${from.top + from.height / 2}px`;
  document.body.appendChild(dot);

  const midX = (from.left + to.left) / 2 + (to.width - from.width) / 4;
  const midY = Math.min(from.top, to.top) - 40;

  gsap
    .timeline({
      onComplete: () => {
        dot.remove();
        onComplete();
      },
    })
    .to(dot, { left: midX, top: midY, duration: 0.22, ease: "power1.out" })
    .to(dot, {
      left: to.left + to.width / 2,
      top: to.top + to.height / 2,
      scale: 0.4,
      opacity: 0.6,
      duration: 0.22,
      ease: "power2.in",
    });
}

function pulseNode(nodeEl) {
  if (!nodeEl || prefersReducedMotion() || typeof gsap === "undefined") return;
  gsap.fromTo(
    nodeEl,
    { scale: 1 },
    {
      scale: 1.25,
      duration: 0.16,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut",
    },
  );
}

async function handleSave() {
  els.saveBtn.disabled = true; // prevent double-clicks / duplicate writes

  try {
    // activeTab only grants tab info because the user just clicked the
    // extension's own action button — the least-privileged way to read
    // "what tab is open right now".
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
    } catch {
      // Most likely cause: chrome.storage.sync's small quota (~100KB
      // total, single items limited too). Plain-language message
      // instead of a raw storage error.
      showToast(
        "Storage limit reached — try switching to Local in settings",
        true,
      );
      return;
    }

    flashSaved();

    const cat = categorize(safe.hostname);
    if (state.view === "orbit") {
      const existingNode = els.orbitStage.querySelector(
        `.orbit-node[data-category="${cat.id}"]`,
      );
      const target = existingNode || els.orbitHub;
      flyDot(els.saveBtn, target, () => {
        renderOrbit(updated);
        // find the (possibly newly created) node and give it a pulse
        requestAnimationFrame(() => {
          const node = els.orbitStage.querySelector(
            `.orbit-node[data-category="${cat.id}"]`,
          );
          pulseNode(node);
        });
      });
    } else {
      renderList(updated);
    }
  } catch {
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

/* ------------------------------------------------------------------ */
/* Delete flow                                                           */
/* ------------------------------------------------------------------ */

async function handleDelete(rawUrl, listItemEl) {
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

  if (prefersReducedMotion() || typeof gsap === "undefined") {
    await finish();
    return;
  }

  gsap.to(listItemEl, {
    opacity: 0,
    height: 0,
    marginBottom: 0,
    paddingTop: 0,
    paddingBottom: 0,
    duration: 0.2,
    ease: "power1.in",
    onComplete: finish,
  });
}

/* ------------------------------------------------------------------ */
/* Settings menu                                                         */
/* ------------------------------------------------------------------ */

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
    els.storageToggleLabel.textContent = `Storage: ${next === "local" ? "Local" : "Synced"}`;
    els.storageToggle.setAttribute("aria-checked", String(next === "sync"));
    await refreshCurrentView();
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

  // A plain <a download> instead of the chrome.downloads API, so we
  // don't need the extra "downloads" permission.
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
    await refreshCurrentView();
    showToast("All links deleted");
  } catch {
    showToast("Could not clear links", true);
  }
  closeSettingsMenu();
});

/* ------------------------------------------------------------------ */
/* Search                                                                 */
/* ------------------------------------------------------------------ */

let searchDebounce = null;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    const hasText = currentFilterText().length > 0;
    if (hasText && state.view === "orbit") {
      state.searchAutoSwitched = true;
      state.activeCategory = null;
      setView("list");
      return;
    }
    if (!hasText && state.searchAutoSwitched) {
      state.searchAutoSwitched = false;
      setView("orbit");
      return;
    }
    await refreshCurrentView();
  }, 120);
});

/* ------------------------------------------------------------------ */
/* Init                                                                   */
/* ------------------------------------------------------------------ */

els.saveBtn.addEventListener("click", handleSave);

(async function init() {
  if (!isRealExtensionContext) {
    document.body.classList.add("standalone-preview");
    els.previewBadge.hidden = false;
  }

  const areaName = await getStorageAreaName();
  els.storageToggleLabel.textContent = `Storage: ${areaName === "local" ? "Local" : "Synced"}`;
  els.storageToggle.setAttribute("aria-checked", String(areaName === "sync"));

  setView("orbit");
})();

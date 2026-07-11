# URL Saver

A small Chrome extension for saving the tab you're on right now, without leaving a trail of 40 open tabs to do it.

I built this because I kept opening a dozen tabs to "read later" and then never reading any of them, because they'd just get lost in tab-hell until I restarted Chrome and lost them for good. This is basically a bookmarks folder that doesn't make me click through three menus to use.

## What it actually does

- Click the extension icon → click "Save current URL" → done. It grabs the tab you're currently on.
- Saved links show up sorted into a little orbit around a center hub - Video, Social, Docs & Dev and a General catch-all, based on the domain. Click a category to see just those links, click the hub to see everything.
- Search box filters whatever you're looking at.
- Delete, copy link or open in a new tab from the list.
- Export everything to a `.json` file if you want a backup.
- Switch between storing links only on this device (Local) or syncing them across your signed-in Chrome browsers (Sync).

The category sorting right now is just simple domain matching (`youtube.com` → Video, `github.com` → Docs & Dev, etc.), not real AI. I left it written as one function so I can swap it for an actual classifier later without touching the rest of the UI. Wanted to be upfront about that instead of overselling it.

## Installing it (it's not on the Web Store)

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Pin it from the puzzle-piece icon so it's visible in your toolbar.

If you edit any file afterward, go back to `chrome://extensions` and hit the little refresh icon on the card - Chrome doesn't auto-reload unpacked extensions.

You can also just double-click `index.html` to preview the UI in a regular browser tab without loading it as an extension at all — it'll load some sample links automatically so it's not just an empty box, and there's a "Preview data" badge so you know you're not looking at your real saved links.

## Project structure

```
url-saver-extension/
├── manifest.json       # extension config (Manifest V3)
├── index.html          # popup markup
├── style.css           # all the styling
├── index.js            # all the logic — storage, rendering, animations
├── vendor/
│   └── gsap.min.js     # animation library, bundled locally
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

Everything is plain HTML/CSS/JS — no build step, no bundler, no framework. You can open `index.js` and read it top to bottom.

## Permissions, and why they're this small

The manifest only asks for `storage` and `activeTab` not the broader `tabs` permission or access to all sites. `activeTab` only lets the extension see the current tab, and only for the moment you click the icon. It can't quietly watch what tabs you have open in the background. Figured if I'm asking people to install something that touches their browsing, it should ask for as little as possible.

Also worth mentioning: there's no `<script>` tag pointing at a CDN anywhere. GSAP (the animation library) is downloaded once and sits in `vendor/gsap.min.js`, so the extension never has to reach out to some third-party server to fetch code at runtime. The CSP in the manifest is locked down to only allow scripts that ship inside the extension itself.

## Known rough edges / stuff I might add later

- Real category detection instead of the domain-matching hack
- A keyboard shortcut to save without opening the popup
- Light theme (right now it's dark-only)
- Tags, beyond just the auto-category

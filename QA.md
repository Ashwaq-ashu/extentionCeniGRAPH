# CineGraph Companion — QA Checklist

Run after every meaningful change. Requires Chrome + unpacked extension load.

## Install / service worker

- [ ] Load unpacked from `cinegraphextention/` — no manifest errors.
- [ ] Service worker starts (Inspect views → Service worker) with no red errors.
- [ ] `chrome.sidePanel.setPanelBehavior` logged only on failure (no error).

## Side panel UI

- [ ] Toolbar icon opens side panel.
- [ ] Profile shows your Letterboxd name, favourites, library stats, rewatches, cold spots.
- [ ] **Picked for You** ranks your Letterboxd watchlist (no mock data).
- [ ] Feedback buttons persist after reload (`chrome.storage.local`).

## Consent & permissions

- [ ] **Analyze this page** and **Score this title** stay disabled until consent is checked.
- [ ] Unchecking consent disables actions again.
- [ ] Extension uses `activeTab` + `scripting` only (no `<all_urls>` in manifest).

## Page analysis (demo regression)

- [ ] Serve `cinegraph_movie_catalogue_demo/index.html` (Live Server on `127.0.0.1` or `localhost`).
- [ ] Console: `Demo catalogue ready: 9 movie cards`.
- [ ] With demo tab active, consent checked, click **Analyze this page**.
- [ ] Side panel lists 9 scored rows with plain bands (Letterboxd-local mode, no Demo prefix).
- [ ] Payload summary shows title count, region, and field names (no token).
- [ ] Inline badges appear once per card; second analyze updates text without duplicate badges.

## Unsupported / error paths

- [ ] Active tab `chrome://extensions` → clear error message (unsupported protocol).
- [ ] Active tab on a generic site (no adapter) → “not enabled yet” message, no DOM scraping.
- [ ] Reload extension, analyze demo again → still works.

## Manual title lookup

- [ ] On any tab, enter a title + optional year → **Score this title**.
- [ ] Result appears in manual section with a Letterboxd-grounded reason.
- [ ] No content script injection required for manual lookup.

## Unresolved titles (API / edge cases)

- [ ] When backend returns `unresolved`, side panel **Unresolved titles** list appears.
- [ ] Unresolved entries do not receive inline badges on the page.

## API mode (when backend is ready)

- [ ] Confirm URL, schema, auth, CORS, and rate limits with backend teammate.
- [ ] Add `host_permissions` for the API host in `manifest.json`.
- [ ] Set `scoringSettings` in storage (see `scoring/BACKEND.md`).
- [ ] Bands show without **Demo ·** prefix; network request succeeds.
- [ ] Missing `profile_token` shows a clear error (no silent failure).

## Privacy

- [ ] Read `PRIVACY.md` matches actual behavior before any public release.

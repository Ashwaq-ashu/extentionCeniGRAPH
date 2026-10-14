# CineGraph Companion — Privacy & Permissions

## What this extension does

CineGraph Companion helps you see taste-match labels for movies on **supported pages you choose to analyze**. Analysis runs only after you check the consent box and click **Analyze this page** or **Score this title** in the side panel.

## Permissions (Chrome)

| Permission   | Why it is needed |
|-------------|------------------|
| `sidePanel` | Shows your profile and analysis controls in the side panel. |
| `storage`   | Saves optional feedback (Interested / Not for me) and the last analysis summary on your device. |
| `activeTab` | Lets the extension interact with the **current tab only** when you start analysis — no broad host access by default. |
| `scripting` | Injects the minimal page bridge on the active tab after you request analysis. |

The extension does **not** request `<all_urls>` or blanket host permissions in this build.

## Data collected and sent

When you analyze a page on a supported site adapter:

- **Collected locally from the page:** movie titles and optional release years from explicit markup (demo catalogue) or future permitted adapters.
- **Manual lookup:** titles and years you type yourself — no page access.

- **Not collected:** passwords, cookies, account details, full page HTML, playback position, or watch history.

Consent is stored locally (`userConsent.analysis`). Unchecking the box in the side panel revokes consent for new analyses.

**Development mode (current default):** titles are scored with an on-device **demo placeholder** provider. Nothing is sent to a CineGraph server until you configure API mode with a confirmed backend URL and profile token.

**Production API mode (when enabled):** a minimal JSON payload `{ profile_token, region, titles[] }` is sent to your team's scoring endpoint. Do not enable until the backend URL, auth, and privacy review are complete.

## Third-party sites

Site-specific adapters are added only when access is permitted by that site's terms or an authorized API. IMDb, Hotstar, and similar services are **not** enabled in this build.

## Your controls

- Revoke permissions anytime via `chrome://extensions` → CineGraph Companion → Details.
- Clear stored feedback by removing extension site data / uninstalling.
- Uninstalling removes locally stored extension data.

## QA checklist (manual)

1. Extension loads without service worker errors.
2. Toolbar icon opens the side panel.
3. Side panel profile and mock recommendations still render.
4. On the local demo (`cinegraph_movie_catalogue_demo/index.html` via Live Server), **Analyze this page** finds 9 titles and shows **Demo ·** badges.
5. Unsupported sites show a clear message instead of scraping.
6. Re-analyzing updates badges without duplicating them.
7. Side panel shows errors when the tab is not analyzable (e.g. `chrome://` pages).
8. Consent checkbox gates analysis actions.
9. Manual **Look up a title** works without reading the active page.
10. Unresolved titles appear in the side panel when the scoring service returns them.

See `QA.md` for the full regression checklist.

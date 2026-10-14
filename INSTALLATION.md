# CineGraph Companion - Chrome Developer-Mode Installation

## Prerequisites
- Google Chrome browser (latest version recommended)
- Chrome enabled for developer mode loading

## Installation Steps

### Step 1: Extract the Extension Files
The extension files are located in: `C:\Users\Ashwaq\Downloads\cinegraphextention\`

### Step 2: Enable Developer Mode in Chrome
1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Toggle **"Developer mode"** on (upper right corner)

### Step 3: Load the Extension Unpacked
1. With Developer mode enabled, click **"Load unpacked"** button (upper left)
2. Select the folder: `C:\Users\Ashwaq\Downloads\cinegraphextention`
3. The extension should now appear in your extensions list

### Step 4: Verify Extension Loaded Successfully
- Look for "CineGraph Companion" in your extensions list
- Check for **no errors** in the extension details
- The toolbar icon should appear (typically puzzle piece icon or pinned extension)

## Using the Extension

### Opening the Side Panel
1. Click the **CineGraph Companion** toolbar icon
2. The side panel should slide open from the left
3. You should see:
   - Profile name (e.g., "Alex Morgan")
   - Favorite movies chips
   - Taste DNA traits
   - Recommendation cards with match badges
   - "Analyze this page" button (initially disabled)
   - "Score this title" button (initially disabled)
   - "Watch this page" button

### Required: Check Consent Before Analysis
1. In the side panel, check the **checkbox** labeled "I agree to analyze the active tab or titles I enter"
2. The analysis buttons will now be enabled
3. **Important**: This consent is stored locally and can be revoked

### Demo Mode - Local Catalogue
1. The extension is pre-configured for local demo catalogue pages
2. Pages on `localhost` or `127.0.0.1` will be recognized
3. The demo catalogue includes movie cards with `[data-movie-card]`, `[data-movie-title]`, and `[data-movie-year]` attributes
4. Demo catalogue was previously served at `http://127.0.0.1:5500/index.html` via Live Server

### Running the Local Demo
1. Ensure you're on a localhost/127.0.0.1 page with movie catalogue markup
2. In the side panel, click **"Watch this page"**
3. The screen detector will inject and search for movie titles
4. Detected titles will appear in the side panel with "Demo ·" badges
5. Or click **"Analyze this page"** after checking consent
6. The side panel will show scored results with "Demo ·" rank bands

### Supported Sites
- Currently only local demo catalogue works (localhost/127.0.0.1)
- Additional site adapters can be added when permitted by site terms
- For other sites, use the **"Look up a title"** manual entry form

### API Mode (When Backend is Ready)
1. Configure via service worker console (`chrome://extensions` → Inspect service worker)
2. Set `chrome.storage.local.set({ scoringSettings: { mode: "api", baseUrl: "https://your-api-host", profileToken: "your-token", region: "IN" } })`
3. Reload the extension
4. Badges will show without "Demo ·" prefix; network request succeeds

## QA Checklist - What to Test

### Install / Service Worker
- [ ] Extension loads without service worker errors
- [ ] Toolbar icon opens side panel
- [ ] Service worker starts with no red errors (Inspect views → Service worker)
- [ ] `chrome.sidePanel.setPanelBehavior` logged only on failure (no error)

### Side Panel UI
- [ ] Profile, Taste DNA, and **MOCK RESULTS** recommendations render from `mock-data.json`
- [ ] Feedback buttons persist after reload (`chrome.storage.local`)
- [ ] **Analyze this page** and **Score this title** stay disabled until consent is checked
- [ ] Unchecking consent disables actions again

### Page Analysis (demo regression)
- [ ] Serve `cinegraph_movie_catalogue_demo/index.html` (Live Server on `127.0.0.1` or `localhost`)
- [ ] Console: `Demo catalogue ready: 9 movie cards`
- [ ] With demo tab active, consent checked, click **Analyze this page**
- [ ] Side panel lists 9 scored rows labeled **Demo ·** when in dev-mock mode
- [ ] Payload summary shows title count, region, and field names (no token)
- [ ] Inline badges appear once per card; second analyze updates text without duplicate badges

### Unsupported / Error Paths
- [ ] Active tab `chrome://extensions` → clear error message (unsupported protocol)
- [ ] Active tab on a generic site (no adapter) → "not enabled yet" message, no DOM scraping
- [ ] Reload extension, analyze demo again → still works

### Manual Title Lookup
- [ ] On any tab, enter a title + optional year → **Score this title**
- [ ] Result appears in manual section with **Demo ·** band in dev-mock mode
- [ ] No content script injection required for manual lookup

### Unresolved Titles (API / Edge Cases)
- [ ] When backend returns `unresolved`, side panel **Unresolved titles** list appears
- [ ] Unresolved entries do not receive inline badges on the page

### Privacy
- [ ] Read `PRIVACY.md` matches actual behavior before any public release

## Troubleshooting

### Side Panel Won't Open
1. Check Chrome console for errors (`F12` → Console, select "CineGraph Companion" extension)
2. Verify manifest.json has `"sidePanel"` permission and `"side_panel"` config
3. Ensure Chrome version supports MV3 sidePanel API
4. Check for red errors in service worker (`Inspect views → Service worker`)

### No Titles Detected on Demo Page
1. Ensure you're on `localhost` or `127.0.0.1`
2. Verify the page has `[data-movie-card]` elements with `[data-movie-title]` and `[data-movie-year]` children
3. Check console for any script errors

### Consent Checkbox Doesn't Enable Buttons
1. Make sure you're checking the checkbox in the side panel, not just reloading
2. The consent is stored in `chrome.storage.local`
3. Try reloading the extension after checking consent

### Mock Scores Showing as "NaN" or Invalid
- This is expected in dev-mock mode. Scores are deterministic placeholders, not real model predictions.
- The band values (Strong Match, Possible Match, etc.) are generated by the mock provider's hash algorithm.

## Known Limitations
- Demo mode uses on-device placeholders, not real model predictions
- Site adapters only for permitted access methods (legal/terms review)
- Backend API integration pending team confirmation
- No `<all_urls>` permission; only `activeTab` + `scripting` used
- Mock data clearly labeled as placeholders with "Demo ·" prefix

## Version Information
- Extension version: 0.5.0
- Manifest version: 3 (Manifest V3)
- Last code fix: sidepanel.js forEach callback syntax correction
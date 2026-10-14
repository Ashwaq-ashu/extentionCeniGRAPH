# CineGraph Companion Extension Implementation Plan

## Phase 1: Fix and Verify Existing Extension

### 1.1 Verify Manifest Configuration
- ✅ manifest.json has correct MV3 configuration
- ✅ "sidePanel" permission declared
- ✅ "side_panel" config with default_path "sidepanel.html"
- ✅ web_accessible_resources includes all needed scripts

### 1.2 Fix Side Panel Opening
- **Issue**: Recent change caused side panel to display error or not open
- **Fix needed**: Verify chrome.sidePanel.setPanelBehavior works in MV3
- **Action**: The setPanelBehavior call on line 44-48 of background.js should configure the side panel. If it fails, check Chrome version compatibility.

### 1.3 Verify Demo Data Loading
- **Function**: loadCineGraph() in sidepanel.js
- **Action**: Fetches mock-data.json and populates UI
- **Verification**: Ensure data.profile.name, favoriteMovies, tasteDNA, and recommendations render correctly

### 1.4 Local Demo Catalogue
- **Adapter**: adapters/demo-catalogue.js
- **Function**: canHandle(urlString) - only allows localhost/127.0.0.1
- **Function**: extract(documentRoot) - reads [data-movie-card] elements
- **Expected**: 9 movie cards detected from demo page

## Phase 2: Implement Title Detection

### 2.1 Screen Detector Integration
- **File**: content/screen-detector.js
- **Function**: watchScreenForTitles() - extracts text from page, detects movie titles using patterns
- **Entry point**: sidepanel.js watchScreenBtn click handler
- **Message**: CINEGRAPH_WATCH_SCREEN sent to background

### 2.2 Demo Catalogue Adapter
- Already implemented in adapters/demo-catalogue.js
- Runs on localhost/127.0.0.1 demo pages
- Extracts titles using [data-movie-card], [data-movie-title], [data-movie-year] selectors

### 2.3 Manual Title Lookup
- Side panel form for entering titles without page access
- Uses scoring-client.js to send titles to backend
- Displays results with Demo · badges in dev mode

## Phase 3: Backend Scoring Integration

### 3.1 Scoring Client
- **File**: scoring/scoring-client.js
- **Mode**: "dev-mock" by default (no backend required)
- **API mode**: Switch via chrome.storage.local.set({scoringSettings: {mode: "api", ...}})
- **Function**: score(payload) - either uses mock provider or fetches from API

### 3.2 Mock Scoring Provider
- **File**: scoring/mock-dev-provider.js
- **Returns**: Deterministic placeholder results labeled "Demo ·"
- **Purpose**: Development and demo mode, not real model predictions

### 3.3 Batch Sending
- Titles sent in batches to avoid exceeding API limits
- Max 50 titles per batch (verify actual limit)
- Split larger lists into valid batches

### 3.4 Response Handling
- Results mapped back to correct titles
- Unresolved titles handled without invented badges
- Confidence scores displayed when available

## Phase 4: UI/Renders

### 4.1 Side Panel UI States
- ready, scanning, scoring, results, no titles found
- unresolved titles, missing profile, unsupported website
- timeout, malformed response, backend unavailable

### 4.2 Badge Display
- Inline badges only when confident match and valid backend data
- Show rank/fit bands, top traits, reason, confidence from backend
- Never fabricate values locally

### 4.3 Demo Mode Banner
- Clearly labelled "Dev-mock mode — scores are placeholders"
- Connected indicator when API mode is active

## Phase 5: Error Handling

### 5.1 Unsupported Sites
- Clear message: "This site is not enabled yet"
- No DOM scraping on unsupported pages

### 5.2 Missing Profile Token
- Clear error shown (no silent failure)
- User can configure API mode when backend is ready

### 5.3 Network Failures
- Timeout handling without crashing
- Graceful degradation to mock mode

### 5.4 Malformed Responses
- Partial response handling
- Invalid data rejected, valid data processed

### 5.5 Consent Gates
- Analysis actions gated behind consent checkbox
- Unchecking consent disables actions again

## Phase 6: Testing and Documentation

### 6.1 QA Checklist Items
- Extension loads without service worker errors
- Toolbar icon opens side panel
- Profile and MOCK RESULTS recommendations render
- Analyze this page finds titles and shows Demo · badges
- Payload summary shows title count, region, field names
- Inline badges appear once per card; re-analyze updates without duplicates
- Unsupported sites show clear message
- Consent checkbox gates analysis actions
- Manual look up a title works without reading page
- Unresolved titles appear in side panel when scoring returns them

### 6.2 Installation Instructions
- Load unpacked from cinegraphextension/
- No manifest errors
- Service worker starts with no red errors

### 6.3 Demo Script
- Open extension, check consent, click Analyze this page
- Verify 9 titles detected, Demo · badges displayed
- Verify side panel profile renders

### 6.4 Known Limitations
- Demo mode uses placeholders, not real model predictions
- Site adapters only for permitted access methods
- Backend API not yet integrated (pending team confirmation)
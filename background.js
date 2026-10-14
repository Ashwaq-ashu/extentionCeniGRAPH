/**
 * CineGraph Companion — background service worker (v0.5.0).
 *
 * Side panel opens on toolbar click via setPanelBehavior.
 * Page analysis runs ONLY after the user clicks "Analyze this page" in the panel —
 * never automatically or silently.
 *
 * Permissions used:
 *   - sidePanel  : open the companion panel
 *   - storage    : persist consent, scoring settings, last analysis
 *   - activeTab  : required for scripting.executeScript on the current tab
 *   - scripting  : inject page-bridge files on demand
 *   - tabs       : query the active tab URL to validate before analysis
 */

// ---------------------------------------------------------------------------
// Import shared modules (service worker scope — importScripts is synchronous)
// ---------------------------------------------------------------------------
try {
  importScripts(
    "shared/stable-id.js",
    "scoring/mock-profile.js",
    "scoring/mock-dev-provider.js",
    "scoring/scoring-client.js",
    "shared/payload-summary.js"
  );} catch (err) {
  console.error("CineGraph: Failed to import shared scripts:", err);
}

// ---------------------------------------------------------------------------
// Files injected into the page on user-triggered analysis
// ---------------------------------------------------------------------------
const INJECTED_FILES = [
  "shared/stable-id.js",
  "scoring/mock-profile.js",
  "scoring/mock-dev-provider.js",
  "scoring/scoring-client.js",
  "shared/payload-summary.js",
  "adapters/demo-catalogue.js",
  "adapters/generic.js",
  "adapters/registry.js",
  "content/page-bridge.js",
];

const SCORE_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Side panel: open when the user clicks the toolbar icon
// ---------------------------------------------------------------------------
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => {
    console.error("CineGraph: Failed to configure side panel behavior:", err);
  });

// ---------------------------------------------------------------------------
// Scoring configuration helpers
// ---------------------------------------------------------------------------
async function getScoringSettings() {
  const stored = await chrome.storage.local.get("scoringSettings");
  const s = stored.scoringSettings || {};
  return {
    mode: s.mode || "dev-mock",
    baseUrl: s.baseUrl || null,
    profileToken: s.profileToken || null,
    region: s.region || "IN",
    authHeaderName: s.authHeaderName || null,
    authHeaderValue: s.authHeaderValue || null,
  };
}

async function syncWorkerScoringConfig() {
  try {
    globalThis.CineGraphScoringConfig = await getScoringSettings();
  } catch (err) {
    console.error("CineGraph: Failed to sync scoring config:", err);
  }
}

// Sync on startup and when storage changes.
syncWorkerScoringConfig();

chrome.runtime.onStartup.addListener(() => {
  syncWorkerScoringConfig();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.scoringSettings) {
    syncWorkerScoringConfig();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isAnalyzableUrl(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns the active tab in the last-focused window, falling back to the
 * current window.  Uses the "tabs" permission (now declared in manifest).
 */
async function getAnalysisTargetTab() {
  try {
    const [primary] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (primary?.id && isAnalyzableUrl(primary.url || "")) {
      return primary;
    }
  } catch (err) {
    console.warn("CineGraph: tabs.query (lastFocusedWindow) failed:", err);
  }

  try {
    const [fallback] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return fallback || null;
  } catch (err) {
    console.warn("CineGraph: tabs.query (currentWindow) failed:", err);
    return null;
  }
}

/**
 * Check whether the page-bridge is already running in this tab so we don't
 * double-inject on repeated analyses.
 */
async function isBridgeReady(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__CineGraphPageBridge),
    });
    return Boolean(result?.result);
  } catch {
    return false;
  }
}

/**
 * Push the current scoring config into the page's global scope so the
 * scoring client inside the injected scripts uses fresh settings.
 */
async function applyScoringConfig(tabId) {
  const config = await getScoringSettings();
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cfg) => {
      globalThis.CineGraphScoringConfig = cfg;
    },
    args: [config],
  });
}

/**
 * Inject all required files into the tab.
 * force=true re-executes the files so Recheck picks up the LATEST adapter
 * code instead of reusing the stale in-page bridge (root cause of the
 * "same titles after scroll" bug). MV3 executeScript re-runs file scripts,
 * and the bridge guards against duplicate message listeners.
 */
async function ensurePageBridge(tabId, { force = false } = {}) {
  await applyScoringConfig(tabId);

  if (!force && (await isBridgeReady(tabId))) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: INJECTED_FILES,
  });
}

// ---------------------------------------------------------------------------
// Score cache: stable-id -> { result, profileToken, mode, region, scoredAt }
// Reused only when identity + profile context are unchanged.
// ---------------------------------------------------------------------------
async function readScoreCache() {
  try {
    const s = await chrome.storage.local.get("scoreCache");
    return s.scoreCache && typeof s.scoreCache === "object" ? s.scoreCache : {};
  } catch {
    return {};
  }
}

function cacheContext() {
  const c = globalThis.CineGraphScoringConfig || {};
  return {
    profileToken: c.profileToken || null,
    mode: c.mode || "dev-mock",
    region: c.region || "IN",
  };
}

function cacheHit(entry, ctx) {
  if (!entry?.result) return false;
  return (
    entry.profileToken === ctx.profileToken &&
    entry.mode === ctx.mode &&
    entry.region === ctx.region
  );
}

/**
 * Score titles in batches. Per-batch failures keep previously cached scores
 * and set scoringPartial instead of wiping useful results.
 */
async function scoreTitlesBatched(titles, { batchSize = SCORE_BATCH_SIZE } = {}) {
  await syncWorkerScoringConfig();
  const client = globalThis.CineGraphScoringClient;
  if (!client) throw new Error("Scoring client is unavailable — importScripts may have failed.");

  const ctx = cacheContext();
  const cache = await readScoreCache();
  const fresh = [];
  const reused = [];
  let scoringPartial = false;
  let scoringError = null;

  const toScore = [];
  for (const t of titles) {
    const key = t.id || globalThis.CineGraphStableId?.stableKey(t) || t.raw_title;
    const hit = cache[key];
    if (hit && cacheHit(hit, ctx)) {
      reused.push(hit.result);
    } else {
      toScore.push(t);
    }
  }

  for (let i = 0; i < toScore.length; i += batchSize) {
    const batch = toScore.slice(i, i + batchSize);
    try {
      const resp = await client.score({
        profile_token: ctx.profileToken,
        region: ctx.region,
        titles: batch,
      });
      for (const r of resp.results || []) {
        const key = r.id || globalThis.CineGraphStableId?.stableKey(r) || r.raw_title;
        cache[key] = { result: r, ...ctx, scoredAt: Date.now() };
        fresh.push(r);
      }
    } catch (err) {
      scoringPartial = true;
      scoringError = err?.message || "Scoring failed.";
      // Fall back to stale-but-valid cache for this batch, if any.
      for (const t of batch) {
        const key = t.id || t.raw_title;
        if (cache[key]?.result) reused.push(cache[key].result);
      }
    }
  }

  try {
    await chrome.storage.local.set({ scoreCache: cache });
  } catch { /* cache persistence is best-effort */ }

  return { fresh, reused, scoringPartial, scoringError };
}

// ---------------------------------------------------------------------------
// Core: score titles inside the service worker (for manual entry)
// ---------------------------------------------------------------------------
async function scoreTitlesInWorker(titles, source) {
  await syncWorkerScoringConfig();

  const config = globalThis.CineGraphScoringConfig || {};
  const client = globalThis.CineGraphScoringClient;

  if (!client) {
    throw new Error(
      "Scoring client is unavailable — importScripts may have failed."
    );
  }

  const payload = {
    profile_token: config.profileToken || null,
    region: config.region || "IN",
    titles: titles.map((entry) => ({
      raw_title: entry.raw_title,
      year: entry.year ?? null,
      source: source || entry.source || "manual-entry",
    })),
  };

  const response = await client.score(payload);
  const demoMode = client.isDemoMode();

  const payloadSummary = globalThis.CineGraphPayloadSummary
    ? globalThis.CineGraphPayloadSummary.fromTitles(
        payload.titles,
        payload.region,
        demoMode
      )
    : {
        titleCount: payload.titles.length,
        region: payload.region,
        demoMode,
        sendsNetworkRequest: !demoMode,
        dataFields: ["raw_title", "year", "source"],
        titles: payload.titles,
      };

  return {
    ok: true,
    demoMode,
    source: source || "manual-entry",
    titles: payload.titles,
    results: response.results,
    unresolved: response.unresolved,
    payloadSummary,
    message: demoMode
      ? "Demo placeholders — not real taste predictions."
      : "Lookup complete.",
  };
}

// ---------------------------------------------------------------------------
// Core: run full page analysis on a tab.
// Recheck flow: fresh DETECT of current DOM -> diff vs previous scan ->
// score only new/changed titles in batches -> merge with valid cached scores.
// Never returns the old cached list as though it were a fresh scan.
// ---------------------------------------------------------------------------
async function runAnalysisOnTab(tab, { recheck = false } = {}) {
  if (!tab?.id || !tab.url) {
    return {
      ok: false,
      error: "no_active_tab",
      message: "No active tab found.",
    };
  }

  if (!isAnalyzableUrl(tab.url)) {
    return {
      ok: false,
      error: "unsupported_protocol",
      message:
        "This page type cannot be analyzed. Open an http(s) catalogue page.",
    };
  }

  try {
    // Always re-inject: guarantees the page runs the LATEST bridge/adapter
    // code even if it was injected by an older extension version.
    await ensurePageBridge(tab.id, { force: true });

    // 1. DETECTION — fresh scan of the page's CURRENT DOM (incl. scrolled-in cards).
    let detection;
    try {
      detection = await chrome.tabs.sendMessage(tab.id, { type: "CINEGRAPH_DETECT_TITLES" });
    } catch {
      // Old bridge (pre-split): fall back to legacy combined analyze.
      detection = null;
    }

    if (!detection) {
      const legacy = await chrome.tabs.sendMessage(tab.id, { type: "CINEGRAPH_ANALYZE_PAGE" });
      if (!legacy?.ok) return legacy;
      const rec = { ...legacy, tabUrl: tab.url, analyzedAt: Date.now(), recheck };
      await chrome.storage.local.set({ lastPageAnalysis: rec });
      return rec;
    }

    if (!detection.ok) {
      // "Unable to scan this page" — keep previous results intact.
      return { ...detection, recheck };
    }

    const SID = globalThis.CineGraphStableId;
    const freshTitles = SID ? SID.dedupeWithinScan(detection.titles || []) : (detection.titles || []);

    // 2. DIFF against previous scan for the same URL.
    const stored = await chrome.storage.local.get("lastPageAnalysis");
    const prev = stored.lastPageAnalysis;
    const samePage = prev?.ok && prev?.tabUrl === tab.url;
    const prevTitles = samePage ? (prev.titles || []) : [];
    const diff = SID
      ? SID.diffScans(freshTitles, prevTitles)
      : { fresh: freshTitles, added: freshTitles.filter((t) => !prevTitles.some((p) => p.raw_title === t.raw_title)), removed: [], kept: [] };

    // 3. SCORING — batch the newly discovered titles; reuse valid cache otherwise.
    let { fresh, reused, scoringPartial, scoringError } = await scoreTitlesBatched(diff.added.length ? diff.added : []);
    // Score pass above only scores `added`; now assemble full result set:
    // kept titles resolve from cache (already warmed by the pass when added==[] path below).
    let mergedResults;
    let unresolved = [];
    if (diff.added.length === 0) {
      // No new titles: resolve the whole fresh set from valid cache without new requests.
      const cache = await readScoreCache();
      const ctx = cacheContext();
      mergedResults = [];
      for (const t of diff.fresh) {
        const key = t.id || t.raw_title;
        const hit = cache[key];
        if (hit && cacheHit(hit, ctx)) mergedResults.push(hit.result);
      }
      // If cache was cleared (e.g. profile changed), score the fresh set once.
      if (mergedResults.length !== diff.fresh.length) {
        const r = await scoreTitlesBatched(diff.fresh);
        mergedResults = [...(r.fresh || []), ...(r.reused || [])];
        scoringPartial = scoringPartial || r.scoringPartial;
        scoringError = scoringError || r.scoringError;
      }
      unresolved = [];
    } else {
      // New titles scored above (`fresh`); kept titles from valid cache.
      const cache = await readScoreCache();
      const ctx = cacheContext();
      const keptResults = [];
      for (const t of diff.kept) {
        const key = t.id || t.raw_title;
        const hit = cache[key];
        // `fresh` already contains newly scored; kept must come from cache.
        if (hit && cacheHit(hit, ctx) && !fresh.some((r) => (r.id || r.raw_title) === key)) {
          keptResults.push(hit.result);
        }
      }
      // Enrich + match strictly by stable id (never merge look-alikes).
      const byId = new Map();
      for (const r of [...fresh, ...keptResults, ...reused]) {
        const k = r.id || r.raw_title;
        if (!byId.has(k)) byId.set(k, r);
      }
      // Order results by detection order (page order), not score order, so
      // Recheck visibly appends newly loaded rails at the end.
      const order = new Map(diff.fresh.map((t, i) => [t.id || t.raw_title, i]));
      mergedResults = [...byId.values()].sort(
        (a, b) => (order.get(a.id || a.raw_title) ?? 9999) - (order.get(b.id || b.raw_title) ?? 9999)
      );
    }

    // Enrich results with page context for hover tooltips.
    const entryById = new Map(diff.fresh.map((t) => [t.id || t.raw_title, t]));
    mergedResults = mergedResults.map((r) => {
      const e = entryById.get(r.id || r.raw_title) || {};
      return {
        ...r,
        id: r.id || e.id || null,
        year: r.year ?? e.year ?? null,
        pageMeta: e.pageMeta || null,
        source: r.source || e.source || detection.adapterId,
      };
    });

    const demoMode = globalThis.CineGraphScoringClient.isDemoMode();
    const payloadSummary = globalThis.CineGraphPayloadSummary
      ? globalThis.CineGraphPayloadSummary.fromTitles(diff.fresh, cacheContext().region, demoMode)
      : {
          titleCount: diff.fresh.length,
          region: cacheContext().region,
          demoMode,
          sendsNetworkRequest: !demoMode,
          dataFields: ["raw_title", "year", "source"],
          titles: diff.fresh,
        };

    const found = diff.fresh.length;
    const addedCount = diff.added.length;
    const analysisRecord = {
      ok: true,
      recheck,
      adapterId: detection.adapterId,
      demoMode,
      titles: diff.fresh,
      results: mergedResults,
      unresolved,
      domVersion: detection.domVersion ?? null,
      scannedAt: detection.scannedAt ?? Date.now(),
      found,
      addedCount,
      keptCount: diff.kept.length,
      removedCount: (diff.removed || []).length,
      scoringPartial: Boolean(scoringPartial),
      scoringError: scoringError || null,
      tabUrl: tab.url,
      analyzedAt: Date.now(),
      payloadSummary,
      message:
        found === 0
          ? "No movie titles were found on this page."
          : addedCount > 0
            ? `Found ${found} title(s) — discovered ${addedCount} new.`
            : `Found ${found} title(s) — no new titles found.`,
    };

    await chrome.storage.local.set({ lastPageAnalysis: analysisRecord });

    // Paint tile glows + chips on the page itself (best-effort: page may have
    // navigated away). Without this, Recheck scores only reach the side panel.
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "CINEGRAPH_RENDER_SCORES",
        results: mergedResults,
        demoMode,
      });
    } catch { /* page render is best-effort only */ }

    return analysisRecord;
  } catch (error) {
    console.error("CineGraph: Analysis failed:", error);
    return {
      ok: false,
      error: "analysis_failed",
      message:
        error?.message ||
        "Could not analyze this page. Reload the tab and try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ── Analyze the active page ────────────────────────────────────────────────
  if (message?.type === "CINEGRAPH_REQUEST_ANALYSIS") {
    (async () => {
      const stored = await chrome.storage.local.get("userConsent");
      if (!stored.userConsent?.analysis) {
        sendResponse({
          ok: false,
          error: "consent_required",
          message: "Please confirm the analysis consent checkbox first.",
        });
        return;
      }

      const tab = await getAnalysisTargetTab();
      const result = await runAnalysisOnTab(tab, { recheck: Boolean(message?.recheck) });
      sendResponse(result);
    })();
    return true; // keep message channel open for async sendResponse
  }

  // ── Score manually entered titles ─────────────────────────────────────────
  if (message?.type === "CINEGRAPH_SCORE_MANUAL_TITLES") {
    (async () => {
      const stored = await chrome.storage.local.get("userConsent");
      if (!stored.userConsent?.analysis) {
        sendResponse({
          ok: false,
          error: "consent_required",
          message: "Please confirm the analysis consent checkbox first.",
        });
        return;
      }

      try {
        const titles = Array.isArray(message.titles) ? message.titles : [];
        const result = await scoreTitlesInWorker(titles, "manual-entry");
        await chrome.storage.local.set({
          lastManualAnalysis: { ...result, analyzedAt: Date.now() },
        });
        sendResponse(result);
      } catch (error) {
        sendResponse({
          ok: false,
          error: "manual_score_failed",
          message: error?.message || "Manual lookup failed.",
        });
      }
    })();
    return true;
  }

  // ── Report current scoring mode ───────────────────────────────────────────
  if (message?.type === "CINEGRAPH_GET_SCORING_MODE") {
    (async () => {
      const settings = await getScoringSettings();
      sendResponse({
        mode: settings.mode,
        demoMode: settings.mode !== "api",
        region: settings.region,
        apiConfigured: Boolean(settings.baseUrl && settings.profileToken),
      });
    })();
    return true;
  }

  return false;
});

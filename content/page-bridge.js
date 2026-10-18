/**
 * Thin page integration layer — runs only after explicit user-triggered injection.
 *
 * Split responsibilities:
 *   DETECTION (CINEGRAPH_DETECT_TITLES): fresh scan of the CURRENT DOM, no scoring.
 *   SCORING: performed by the background worker in batches (see background.js).
 * Legacy CINEGRAPH_ANALYZE_PAGE is kept for backward compat and now reuses detection.
 */

globalThis.__CineGraphPageBridge = true;

const BADGE_CLASS = "cinegraph-match-badge";
const CARD_STRONG = "cinegraph-card-strong";
const CARD_POSSIBLE = "cinegraph-card-possible";
const CARD_WEAK = "cinegraph-card-weak";
const CARD_CLASSES = [CARD_STRONG, CARD_POSSIBLE, CARD_WEAK];

/** One <style> tag drives tile glow + hover. Injected once, reused on Recheck. */
function ensureCardStyles() {
  try {
    if (document.getElementById("cinegraph-hover-styles")) return;
    const style = document.createElement("style");
    style.id = "cinegraph-hover-styles";
    style.textContent = `
      .${CARD_STRONG}, .${CARD_POSSIBLE}, .${CARD_WEAK} { position: relative; border-radius: 10px; transition: box-shadow .15s ease, outline-color .15s ease; }
      .${CARD_STRONG} { outline: 3px solid #22c55e !important; outline-offset: 2px; box-shadow: 0 0 10px rgba(34,197,94,.55) !important; }
      .${CARD_POSSIBLE} { outline: 3px solid #f59e0b !important; outline-offset: 2px; box-shadow: 0 0 10px rgba(245,158,11,.5) !important; }
      .${CARD_WEAK} { outline: 2px solid #8b5cf6 !important; outline-offset: 2px; }
      .${CARD_STRONG}:hover { box-shadow: 0 0 22px rgba(34,197,94,.9) !important; outline-width: 4px !important; cursor: pointer; }
      .${CARD_POSSIBLE}:hover { box-shadow: 0 0 22px rgba(245,158,11,.9) !important; outline-width: 4px !important; cursor: pointer; }
      .${CARD_WEAK}:hover { box-shadow: 0 0 16px rgba(139,92,246,.8) !important; cursor: pointer; }
      .${BADGE_CLASS} { position: absolute !important; top: 6px !important; left: 6px !important; z-index: 2147483646 !important; pointer-events: none !important; margin: 0 !important; font-size: 10px !important; font-weight: 800 !important; line-height: 1.2 !important; padding: 3px 8px !important; border-radius: 999px !important; white-space: nowrap !important; max-width: calc(100% - 12px) !important; overflow: hidden !important; text-overflow: ellipsis !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  } catch { /* page CSP may block inline <style>; per-tile inline fallback below still applies */ }
}

/** Never paint site chrome (sidebar nav, top header): clean it if previously painted. */
function inSiteChromeEl(el) {
  try {
    return !!el?.closest?.(
      "nav, header, aside, [role='navigation'], [role='banner'], [role='complementary'], [class*='sidebar'], [class*='topnav'], [class*='navbar'], [class*='site-header']"
    );
  } catch { return false; }
}

function bandToCardClass(band) {
  if (band === "Strong Match") return CARD_STRONG;
  if (band === "Possible Match") return CARD_POSSIBLE;
  return CARD_WEAK;
}

/** Inline fallback glow if the page blocks our <style> tag (strict CSP). */
function applyCardGlow(card, band) {
  try {
    if (!card || !card.style) return;
    const glow = {
      "Strong Match": { outline: "3px solid #22c55e", boxShadow: "0 0 10px rgba(34,197,94,.55)" },
      "Possible Match": { outline: "3px solid #f59e0b", boxShadow: "0 0 10px rgba(245,158,11,.5)" },
      "Weak Match": { outline: "2px solid #8b5cf6", boxShadow: "none" },
    }[band] || { outline: "2px solid #8b5cf6", boxShadow: "none" };
    card.style.outline = glow.outline;
    card.style.outlineOffset = "2px";
    card.style.borderRadius = card.style.borderRadius || "10px";
    if (glow.boxShadow !== "none") card.style.boxShadow = glow.boxShadow;
  } catch { /* ignore */ }
}

function clearCardGlow(card) {
  try {
    if (!card) return;
    card.classList?.remove(...CARD_CLASSES);
    if (card.style) {
      card.style.outline = "";
      card.style.outlineOffset = "";
      card.style.boxShadow = "";
    }
    if (card.dataset?.cinegraphBand) delete card.dataset.cinegraphBand;
    // Restore the page's own tooltip if we overwrote it.
    if (card.dataset && "cgOrigTitle" in card.dataset) {
      if (card.dataset.cgOrigTitle) card.setAttribute("title", card.dataset.cgOrigTitle);
      else card.removeAttribute("title");
      delete card.dataset.cgOrigTitle;
    }
  } catch { /* ignore */ }
}

function setTileTip(el, tip) {
  try {
    if (!el || !el.setAttribute) return;
    if (el.dataset && !("cgOrigTitle" in el.dataset)) {
      el.dataset.cgOrigTitle = el.getAttribute("title") || "";
    }
    el.setAttribute("title", tip);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// DOM version tracking: MutationObserver bumps __CineGraphDomVersion whenever
// cards are appended (e.g. infinite scroll / lazy rails). No polling, no
// auto-scroll, no interference with the page.
// ---------------------------------------------------------------------------
globalThis.__CineGraphDomVersion = globalThis.__CineGraphDomVersion || 0;
let __cgMoTimer = null;
try {
  if (!globalThis.__CineGraphObserverAttached && typeof MutationObserver !== "undefined" && document.body) {
    const mo = new MutationObserver((mutations) => {
      let touched = false;
      for (const m of mutations) {
        if (m.type === "childList" && (m.addedNodes?.length || m.removedNodes?.length)) { touched = true; break; }
        if (m.type === "attributes" && (m.attributeName === "alt" || m.attributeName === "aria-label" || m.attributeName === "src")) { touched = true; break; }
      }
      if (!touched) return;
      clearTimeout(__cgMoTimer);
      __cgMoTimer = setTimeout(() => { globalThis.__CineGraphDomVersion += 1; }, 300);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["alt", "aria-label", "src"] });
    globalThis.__CineGraphObserverAttached = true;
  }
} catch { /* observer is best-effort only */ }

function badgeLabel(result, demoMode) {
  if (demoMode || result.is_demo) {
    return `Demo · ${result.band}`;
  }
  return result.band;
}

function hoverInfo(result, entry) {
  const parts = [result.raw_title];
  const year = result.year ?? entry?.year;
  if (year) parts.push(`(${year})`);
  const meta = entry?.pageMeta || result.pageMeta;
  if (meta?.section) parts.push(`§ ${meta.section}`);
  if (meta?.tag) parts.push(`[${meta.tag}]`);
  parts.push(`— ${badgeLabel(result, false)}`);
  if (result.reason) parts.push(`: ${result.reason}`);
  return parts.join(" ");
}

function applyBadgeStyles(badge, band) {
  const palette = {
    "Strong Match": { background: "#0e2f1d", color: "#9de6bc", border: "1px solid #2d6b47" },
    "Possible Match": { background: "#33270f", color: "#f0ce89", border: "1px solid #6a5020" },
    "Weak Match": { background: "#292039", color: "#c4a7ff", border: "1px solid #7654a8" },
  };
  const p = palette[band] || palette["Weak Match"];
  // Inline fallback mirrors the overlay pill (used only if page CSP blocks our <style>).
  Object.assign(badge.style, {
    position: "absolute",
    top: "6px",
    left: "6px",
    zIndex: "2147483646",
    pointerEvents: "none",
    display: "inline-block",
    margin: "0",
    padding: "3px 8px",
    borderRadius: "999px",
    background: p.background,
    color: p.color,
    fontSize: "10px",
    fontWeight: "800",
    lineHeight: "1.2",
    border: p.border,
    whiteSpace: "nowrap",
    maxWidth: "calc(100% - 12px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
}

function renderBadges(entries, results, demoMode) {
  const resultById = new Map();
  const resultByTitle = new Map();
  (results || []).forEach((r) => {
    if (r.id) resultById.set(r.id, r);
    if (r.raw_title && !resultByTitle.has(r.raw_title)) resultByTitle.set(r.raw_title, r);
  });
  const entryById = new Map((entries || []).map((e) => [e.id || e.raw_title, e]));

  ensureCardStyles();

  // Clear previous scan's paint so Recheck repaints fresh; badges stuck on
  // site chrome (sidebar/header) are removed outright.
  try {
    document.querySelectorAll(`.${CARD_STRONG}, .${CARD_POSSIBLE}, .${CARD_WEAK}, .${BADGE_CLASS}`)
      .forEach((el) => {
        if (el.classList?.contains(BADGE_CLASS)) {
          if (inSiteChromeEl(el)) el.remove();
          else el.remove(); // chips are re-created per scan at the right tile
          return;
        }
        clearCardGlow(el);
      });
  } catch { /* ignore */ }

  let painted = 0;

  entries.forEach((entry) => {
    const result = (entry.id && resultById.get(entry.id)) || resultByTitle.get(entry.raw_title);
    const anchor = entry.titleElement;
    // Target tile: prefer the card wrapper (poster container) so the whole
    // movie tile glows; fall back to the anchor's parent.
    const tile = entry.cardElement || anchor?.parentElement || null;

    if (!result) {
      return;
    }

    // Defense in depth: the adapter already skips site chrome, but never
    // paint nav/header tiles even if a stale detection contains them.
    if (inSiteChromeEl(tile) || inSiteChromeEl(anchor)) {
      if (tile) clearCardGlow(tile);
      if (anchor && anchor !== tile) clearCardGlow(anchor);
      return;
    }

    const tip = hoverInfo(result, entryById.get(result.id || result.raw_title));
    const cls = bandToCardClass(result.band);

    // 1. Tile glow: hovering the actual movie shows green/amber/purple.
    // Paint BOTH the wrapper and the anchor itself (usually the <img> poster,
    // which is guaranteed visible even when the wrapper is a 1px layout div).
    for (const el of [tile, anchor]) {
      if (!el || !el.setAttribute) continue;
      if (el === anchor && tile === anchor) continue;
      try {
        el.classList?.remove(...CARD_CLASSES);
        el.classList?.add(cls);
        applyCardGlow(el, result.band);
        el.setAttribute("data-cinegraph-band", result.band);
        setTileTip(el, tip);
      } catch { /* ignore */ }
    }

    // 2. Corner overlay chip (absolute, never stretches page layout).
    if (!anchor) {
      painted += 1;
      return;
    }
    const card = entry.cardElement;
    const host = (card && card.appendChild && !inSiteChromeEl(card))
      ? card
      : (anchor.parentElement || null);
    if (!host || inSiteChromeEl(host)) {
      painted += 1;
      return;
    }
    // Overlay needs a positioned ancestor — only touch static positioning.
    try {
      const pos = window.getComputedStyle ? window.getComputedStyle(host).position : "";
      if ((!pos || pos === "static") && host.style) host.style.position = "relative";
    } catch { /* ignore */ }
    let badge = host.querySelector(`:scope > .${BADGE_CLASS}`);
    if (!badge) {
      badge = document.createElement("div");
      badge.className = BADGE_CLASS;
      try {
        host.appendChild(badge);
      } catch { painted += 1; return; }
    }

    badge.textContent = `🎬 ${badgeLabel(result, demoMode)}`;
    badge.title = tip;
    applyBadgeStyles(badge, result.band);
    painted += 1;
  });

  return painted;
}

/** Serialize entries for postMessage (drops live element refs). */
function serializeEntries(entries) {
  return (entries || []).map((e) => ({
    id: e.id || null,
    catalogue_id: e.catalogue_id || null,
    raw_title: e.raw_title,
    year: e.year ?? null,
    source: e.source || null,
    pageMeta: e.pageMeta || null,
  }));
}

/** Fresh detection pass over the CURRENT DOM. No caching, no scoring. */
function detectCurrentPage() {
  const adapter = globalThis.CineGraphAdapters
    ? globalThis.CineGraphAdapters.findFor(window.location.href)
    : null;

  if (!adapter) {
    return {
      ok: false,
      error: "unsupported_site",
      message: "This site is not enabled yet. Use the local demo catalogue or a supported integration.",
      adapterId: null,
      titles: [],
      domVersion: globalThis.__CineGraphDomVersion || 0,
      url: window.location.href,
      scannedAt: Date.now(),
    };
  }

  let raw;
  try {
    raw = adapter.extract(document);
  } catch (err) {
    return {
      ok: false,
      error: "scan_failed",
      message: "Unable to scan this page. Reload the tab and try again.",
      adapterId: adapter.id,
      titles: [],
      domVersion: globalThis.__CineGraphDomVersion || 0,
      url: window.location.href,
      scannedAt: Date.now(),
    };
  }

  // Within-scan dedupe by stable id (keeps badges + scoring 1:1).
  const seen = new Set();
  const entries = [];
  for (const e of raw || []) {
    const key = e.id || e.raw_title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }

  if (!entries.length) {
    return {
      ok: false,
      error: "no_titles",
      message: "No movie titles were found on this page.",
      adapterId: adapter.id,
      titles: [],
      domVersion: globalThis.__CineGraphDomVersion || 0,
      url: window.location.href,
      scannedAt: Date.now(),
    };
  }

  // Live entries kept locally for badge rendering only (not sent over messages).
  // Cached globally so worker-scored Recheck results can be painted later.
  globalThis.__CineGraphLastLiveEntries = entries;

  return {
    ok: true,
    adapterId: adapter.id,
    titles: serializeEntries(entries),
    domVersion: globalThis.__CineGraphDomVersion || 0,
    url: window.location.href,
    scannedAt: Date.now(),
    // Live entries kept locally for badge rendering only (not sent over messages).
    _liveEntries: entries,
  };
}

async function analyzeCurrentPage() {
  const detection = detectCurrentPage();
  if (!detection.ok) {
    const { _liveEntries, ...rest } = detection;
    return rest;
  }

  const scoringClient = globalThis.CineGraphScoringClient;
  if (!scoringClient) {
    return {
      ok: false,
      error: "scoring_unavailable",
      message: "Scoring client failed to load.",
      adapterId: detection.adapterId,
      titles: detection.titles,
      results: [],
      unresolved: [],
    };
  }

  const config = globalThis.CineGraphScoringConfig || {};
  const payload = {
    profile_token: config.profileToken || null,
    region: config.region || "IN",
    titles: detection.titles,
  };

  try {
    const response = await scoringClient.score(payload);
    const demoMode = scoringClient.isDemoMode();
    const byId = new Map((detection.titles || []).map((e) => [e.id || e.raw_title, e]));
    const enriched = (response.results || []).map((r) => {
      const e = byId.get(r.id || r.raw_title) || {};
      return {
        ...r,
        id: r.id || e.id || null,
        year: r.year ?? e.year ?? null,
        pageMeta: e.pageMeta || null,
        source: r.source || e.source || detection.adapterId,
      };
    });
    renderBadges(detection._liveEntries, enriched, demoMode);

    const payloadSummary = globalThis.CineGraphPayloadSummary
      ? globalThis.CineGraphPayloadSummary.fromTitles(payload.titles, payload.region, demoMode)
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
      adapterId: detection.adapterId,
      demoMode,
      titles: detection.titles,
      results: enriched,
      unresolved: response.unresolved,
      domVersion: detection.domVersion,
      payloadSummary,
      message: demoMode
        ? `Local-library scores for ${enriched.length} title(s).`
        : "Analysis complete.",
    };
  } catch (error) {
    return {
      ok: false,
      error: "scoring_failed",
      message: error?.message || "Scoring failed.",
      adapterId: detection.adapterId,
      titles: detection.titles,
      results: [],
      unresolved: [],
    };
  }
}

// Guard: re-injection on Recheck must not stack duplicate listeners.
if (!globalThis.__CineGraphBridgeListener) {
  globalThis.__CineGraphBridgeListener = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CINEGRAPH_DETECT_TITLES") {
      try {
        const { _liveEntries, ...rest } = detectCurrentPage();
        sendResponse(rest);
      } catch (err) {
        sendResponse({ ok: false, error: "scan_failed", message: err?.message || "Scan failed.", titles: [] });
      }
      return true;
    }
    // Worker-scored Recheck results: paint tile glows + chips from cached live entries.
    if (message?.type === "CINEGRAPH_RENDER_SCORES") {
      try {
        const live = globalThis.__CineGraphLastLiveEntries || [];
        const count = renderBadges(live, message.results || [], Boolean(message.demoMode));
        sendResponse({ ok: true, rendered: count });
      } catch (err) {
        sendResponse({ ok: false, error: "render_failed", message: err?.message || "Render failed." });
      }
      return true;
    }
    if (message?.type === "CINEGRAPH_GET_DOM_VERSION") {
      sendResponse({ domVersion: globalThis.__CineGraphDomVersion || 0, url: window.location.href });
      return true;
    }
    if (message?.type !== "CINEGRAPH_ANALYZE_PAGE") {
      return false;
    }
    analyzeCurrentPage().then(sendResponse);
    return true;
  });
}

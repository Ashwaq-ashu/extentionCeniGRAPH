/**
 * sidepanel-analysis.js
 * Handles the "Analyze this page" and "Look up a title" sections.
 * All analysis is triggered by explicit user action only.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setAnalyzeStatus(element, text, tone) {
  element.textContent = text || "";
  element.classList.remove("error", "success");
  if (tone) {
    element.classList.add(tone);
  }
}

function formatPayloadSummary(summary) {
  if (!summary) {
    return "";
  }

  const networkLine = summary.demoMode
    ? "Stays on device (dev-mock mode)."
    : "Will send a minimal JSON request to your configured scoring API.";

  return `${summary.titleCount} title(s) · region ${summary.region} · fields: ${summary.dataFields.join(", ")}. ${networkLine}`;
}

function bandRank(band) {
  if (band === "Strong Match") return 0;
  if (band === "Possible Match") return 1;
  return 2;
}

function renderScoreRows(container, analysis) {
  container.innerHTML = "";

  if (!analysis?.ok || !analysis.results?.length) {
    container.hidden = true;
    return;
  }

  const titleMeta = new Map((analysis.titles || []).map((t) => [t.raw_title, t]));
  const demo = Boolean(analysis.demoMode);

  // Structured: group by band (Strong → Possible → Weak), stable order inside.
  const groups = [
    { band: "Strong Match", label: "Strong matches", items: [] },
    { band: "Possible Match", label: "Possible matches", items: [] },
    { band: "Weak Match", label: "Weak matches", items: [] },
  ];
  const byBand = new Map(groups.map((g) => [g.band, g]));
  (analysis.results || []).forEach((result) => {
    const g = byBand.get(result.band) || byBand.get("Weak Match");
    g.items.push(result);
  });

  let rank = 0;
  groups.forEach((group) => {
    if (!group.items.length) return;

    const heading = document.createElement("div");
    heading.className = "result-group-heading";
    const dot = document.createElement("span");
    dot.className = "group-dot " + (group.band === "Strong Match" ? "strong" : group.band === "Possible Match" ? "possible" : "weak");
    const text = document.createElement("span");
    text.textContent = `${group.label} (${group.items.length})`;
    heading.append(dot, text);
    container.appendChild(heading);

    group.items.forEach((result) => {
      rank += 1;
      const meta = titleMeta.get(result.raw_title) || {};
      const year = result.year ?? meta.year;
      const pageMeta = result.pageMeta || meta.pageMeta;
      const source = result.source || meta.source;

      const row = document.createElement("div");
      row.className = "analyze-result-row";
      row.tabIndex = 0;
      row.title = [
        year ? `${result.raw_title} (${year})` : result.raw_title,
        [pageMeta?.section, pageMeta?.tag, source].filter(Boolean).join(" • "),
        result.reason || "",
      ].filter(Boolean).join("\n");

      const top = document.createElement("div");
      top.className = "row-top";

      const left = document.createElement("span");
      left.className = "row-left";
      const rankEl = document.createElement("span");
      rankEl.className = "row-rank";
      rankEl.textContent = `#${rank}`;
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = year ? `${result.raw_title} (${year})` : result.raw_title;
      left.append(rankEl, title);

      const band = document.createElement("span");
      band.className = "band " + (demo || result.is_demo ? "demo " : "") +
        (result.band === "Strong Match" ? "strong" : result.band === "Possible Match" ? "possible" : "weak");
      band.textContent = demo || result.is_demo ? `Demo · ${result.band}` : result.band;
      top.append(left, band);
      row.appendChild(top);

      const contextBits = [pageMeta?.section, pageMeta?.tag, source].filter(Boolean);
      if (contextBits.length) {
        const ctx = document.createElement("div");
        ctx.className = "row-meta muted small";
        ctx.textContent = contextBits.join(" • ");
        row.appendChild(ctx);
      }

      if (result.reason) {
        const detail = document.createElement("div");
        detail.className = "row-reason";
        detail.textContent = result.reason;
        row.appendChild(detail);
      }

      container.appendChild(row);
    });
  });

  container.hidden = false;
}

function renderUnresolved(container, unresolved) {
  container.innerHTML = "";
  const items = (unresolved || []).filter(Boolean);

  if (!items.length) {
    container.hidden = true;
    return;
  }

  const heading = document.createElement("h4");
  heading.textContent = "Unresolved titles";

  const list = document.createElement("ul");
  items.forEach((title) => {
    const item = document.createElement("li");
    item.textContent = typeof title === "string" ? title : String(title);
    list.appendChild(item);
  });

  container.append(heading, list);
  container.hidden = false;
}

// ---------------------------------------------------------------------------
// Scoring mode indicator
// ---------------------------------------------------------------------------

async function setupScoringModeBanner() {
  const banner = document.getElementById("demo-mode-banner");
  const bannerText = document.getElementById("demo-mode-text");
  if (!banner || !bannerText) {
    return;
  }

  try {
    const modeInfo = await chrome.runtime.sendMessage({
      type: "CINEGRAPH_GET_SCORING_MODE",
    });

    if (modeInfo?.demoMode) {
      bannerText.textContent =
        "Dev-mock mode — scores are placeholders, not real taste predictions.";
      banner.hidden = false;
    } else {
      // API mode: show a subtle connected indicator instead of the warning.
      banner.style.background = "#0e2718";
      banner.style.borderColor = "#2d6b47";
      banner.style.color = "#9de6bc";
      banner.querySelector(".banner-icon").textContent = "✅";
      bannerText.textContent = "Connected to scoring API.";
      banner.hidden = false;
    }
  } catch {
    // Service worker not ready yet — banner stays hidden.
  }
}

// ---------------------------------------------------------------------------
// Consent gate — gates both buttons behind a checkbox
// ---------------------------------------------------------------------------

async function setupConsentGate() {
  const consentCheckbox = document.getElementById("analysis-consent");
  const analyzeButton = document.getElementById("analyze-page-btn");
  const recheckButton = document.getElementById("recheck-page-btn");
  const manualButton = document.getElementById("manual-score-btn");

  const stored = await chrome.storage.local.get("userConsent");
  const granted = Boolean(stored.userConsent?.analysis);

  consentCheckbox.checked = granted;
  analyzeButton.disabled = !granted;
  manualButton.disabled = !granted;
  if (recheckButton && recheckButton.hidden === false) recheckButton.disabled = !granted;

  consentCheckbox.addEventListener("change", async () => {
    const analysis = consentCheckbox.checked;

    if (analysis) {
      await chrome.storage.local.set({
        userConsent: {
          analysis: true,
          updatedAt: Date.now(),
        },
      });
    } else {
      await chrome.storage.local.remove("userConsent");
    }

    analyzeButton.disabled = !analysis;
    manualButton.disabled = !analysis;
    if (recheckButton) recheckButton.disabled = !analysis;
  });
}

// ---------------------------------------------------------------------------
// Page analysis section
// ---------------------------------------------------------------------------

async function setupPageAnalysis() {
  const analyzeButton = document.getElementById("analyze-page-btn");
  const recheckButton = document.getElementById("recheck-page-btn");
  const analyzeStatus = document.getElementById("analyze-status");
  const analyzeResults = document.getElementById("analyze-results");
  const analyzeUnresolved = document.getElementById("analyze-unresolved");
  const payloadSummary = document.getElementById("payload-summary");

  function showRecheck(hasPrior) {
    if (!recheckButton) return;
    recheckButton.hidden = !hasPrior;
  }

  // Restore previous analysis results if they exist.
  const stored = await chrome.storage.local.get("lastPageAnalysis");
  if (stored.lastPageAnalysis?.ok) {
    renderScoreRows(analyzeResults, stored.lastPageAnalysis);
    renderUnresolved(analyzeUnresolved, stored.lastPageAnalysis.unresolved);
    if (stored.lastPageAnalysis.payloadSummary) {
      payloadSummary.textContent = formatPayloadSummary(
        stored.lastPageAnalysis.payloadSummary
      );
      payloadSummary.hidden = false;
    }
    const count = stored.lastPageAnalysis.results?.length ?? 0;
    setAnalyzeStatus(
      analyzeStatus,
      stored.lastPageAnalysis.message || `Last analysis: ${count} titles.`,
      "success"
    );
    showRecheck(true);
  }

  async function runScan({ recheck }) {
    const btn = recheck ? recheckButton : analyzeButton;
    analyzeButton.disabled = true;
    if (recheckButton) recheckButton.disabled = true;
    // "Scanning page..."
    setAnalyzeStatus(analyzeStatus, recheck ? "Scanning page for new titles…" : "Scanning page…", null);
    payloadSummary.hidden = true;
    analyzeUnresolved.hidden = true;
    // Keep old results visible during rescan so failures don't wipe them.

    try {
      const analysis = await chrome.runtime.sendMessage({
        type: "CINEGRAPH_REQUEST_ANALYSIS",
        recheck,
      });

      if (!analysis?.ok) {
        setAnalyzeStatus(
          analyzeStatus,
          analysis?.message || "Unable to scan this page.",
          "error"
        );
        return;
      }

      const found = analysis.found ?? analysis.results?.length ?? 0;
      const added = analysis.addedCount ?? 0;
      // "Found N titles" / "Discovered M new" / "No new titles found"
      let status;
      if (recheck) {
        status = added > 0
          ? `Found ${found} title(s) — discovered ${added} new. Scoring new titles…`
          : `Found ${found} title(s) — no new titles found.`;
      } else {
        status = `Found ${found} title(s).`;
      }
      setAnalyzeStatus(analyzeStatus, status, null);

      if (analysis.payloadSummary) {
        payloadSummary.textContent = formatPayloadSummary(analysis.payloadSummary);
        payloadSummary.hidden = false;
      }

      renderScoreRows(analyzeResults, analysis);
      renderUnresolved(analyzeUnresolved, analysis.unresolved);

      // Final state after scoring resolved by the worker.
      const tail = analysis.scoringPartial
        ? " Some titles could not be identified — showing previous valid scores."
        : (analysis.unresolved?.length ? ` ${analysis.unresolved.length} unresolved.` : "");
      setAnalyzeStatus(
        analyzeStatus,
        recheck
          ? (added > 0
              ? `Found ${found} title(s) — discovered ${added} new.${tail}`
              : `Found ${found} title(s) — no new titles found.${tail}`)
          : (analysis.message || `Found ${found} scored title(s) on this page.`) + tail,
        "success"
      );
      showRecheck(true);
    } catch (error) {
      setAnalyzeStatus(
        analyzeStatus,
        "Could not reach the extension background worker. Try reloading the extension.",
        "error"
      );
      console.error("CineGraph analyze error:", error);
    } finally {
      const consent = await chrome.storage.local.get("userConsent");
      const can = Boolean(consent.userConsent?.analysis);
      analyzeButton.disabled = !can;
      if (recheckButton) recheckButton.disabled = !can;
    }
  }

  analyzeButton.addEventListener("click", () => runScan({ recheck: false }));
  if (recheckButton) recheckButton.addEventListener("click", () => runScan({ recheck: true }));
}

// ---------------------------------------------------------------------------
// Manual title lookup section
// ---------------------------------------------------------------------------

async function setupManualLookup() {
  const form = document.getElementById("manual-title-form");
  const titleInput = document.getElementById("manual-title");
  const yearInput = document.getElementById("manual-year");
  const manualResults = document.getElementById("manual-results");
  const manualButton = document.getElementById("manual-score-btn");

  // Restore previous manual results.
  const stored = await chrome.storage.local.get("lastManualAnalysis");
  if (stored.lastManualAnalysis?.ok) {
    renderScoreRows(manualResults, stored.lastManualAnalysis);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    manualButton.disabled = true;
    manualResults.hidden = true;

    const raw_title = titleInput.value.trim();
    if (!raw_title) {
      return;
    }

    const yearText = yearInput.value.trim();
    let year = null;
    if (yearText) {
      const parsed = Number.parseInt(yearText, 10);
      year = Number.isFinite(parsed) ? parsed : null;
    }

    try {
      const analysis = await chrome.runtime.sendMessage({
        type: "CINEGRAPH_SCORE_MANUAL_TITLES",
        titles: [{ raw_title, year }],
      });

      if (!analysis?.ok) {
        manualResults.hidden = true;
        titleInput.setCustomValidity(analysis?.message || "Lookup failed.");
        titleInput.reportValidity();
        return;
      }

      titleInput.setCustomValidity("");
      renderScoreRows(manualResults, analysis);

      if (analysis.unresolved?.length) {
        const note = document.createElement("p");
        note.className = "muted small";
        note.textContent = `Unresolved: ${analysis.unresolved.join(", ")}`;
        manualResults.appendChild(note);
      }
    } catch (error) {
      console.error("CineGraph manual lookup error:", error);
      titleInput.setCustomValidity(
        "Could not reach extension worker. Try reloading."
      );
      titleInput.reportValidity();
    } finally {
      const consent = await chrome.storage.local.get("userConsent");
      manualButton.disabled = !consent.userConsent?.analysis;
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setupScoringModeBanner();
setupConsentGate();
setupPageAnalysis();
setupManualLookup();

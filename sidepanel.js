async function loadCineGraph() {
  const favorites = document.getElementById("favorites");
  const traits = document.getElementById("traits");
  const recommendations = document.getElementById("recommendations");
  const analyzePageBtn = document.getElementById("analyze-page-btn");
  const watchScreenBtn = document.getElementById("watch-screen-btn");
  const watchScreenStatus = document.getElementById("watch-screen-status");
  const watchScreenResults = document.getElementById("watch-screen-results");
  const manualTitleForm = document.getElementById("manual-title-form");
  const analysisConsent = document.getElementById("analysis-consent");
  const savedFeedback = await chrome.storage.local.get("movieFeedback");
  const feedbackData = savedFeedback.movieFeedback || {};

  // ── TMDB settings wiring ─────────────────────────────────────────────
  await setupTmdbSettings();

  // ── Real profile: bundled Letterboxd library, no mock data ────────────
  try {
    const res = await chrome.runtime.sendMessage({ type: "CINEGRAPH_GET_PROFILE" });
    if (!res?.ok || !res.profile) throw new Error(res?.message || "Profile unavailable");
    renderProfile(res.profile);
    loadRecommendations(feedbackData);
  } catch (error) {
    document.getElementById("user-name").textContent = "Profile unavailable";
    favorites.textContent = "Could not load your Letterboxd library.";
    console.error("CineGraph error:", error);
  }

  function renderProfile(profile) {
    const nameEl = document.getElementById("user-name");
    nameEl.textContent = profile.username ? `${profile.name} · @${profile.username}` : profile.name;

    const sub = document.getElementById("user-sub");
    if (sub) {
      const bits = [];
      if (profile.bio) bits.push(profile.bio);
      else if (profile.location) bits.push(profile.location);
      if (profile.stats?.rated) bits.push(`${profile.stats.rated} films rated`);
      sub.textContent = bits.join(" — ") || "Your taste. Your next obsession.";
    }

    (profile.favorites || []).forEach((movie) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = movie.year ? `${movie.title} (${movie.year})` : movie.title;
      chip.title = movie.rating != null ? `Your rating: ${movie.rating}★` : "";
      favorites.appendChild(chip);
    });

    (profile.tasteDNA || []).forEach((trait) => {
      const item = document.createElement("div");
      item.className = "trait";
      const name = document.createElement("span");
      name.className = "trait-name";
      name.textContent = trait.trait;
      const level = document.createElement("span");
      level.className = "trait-level";
      level.textContent = trait.level;
      item.append(name, level);
      traits.appendChild(item);
    });

    const rewatched = document.getElementById("most-watched");
    if (rewatched) {
      if ((profile.mostWatched || []).length) {
        profile.mostWatched.slice(0, 6).forEach((m) => {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = m.year ? `${m.title} (${m.year})` : m.title;
          chip.title = m.why || "Rewatched";
          rewatched.appendChild(chip);
        });
      } else {
        rewatched.textContent = "No rewatches logged yet.";
      }
    }

    const cold = document.getElementById("cold-spots");
    if (cold) {
      if ((profile.coldSpots || []).length) {
        profile.coldSpots.slice(0, 6).forEach((m) => {
          const chip = document.createElement("span");
          chip.className = "chip cold";
          chip.textContent = m.year ? `${m.title} (${m.year})` : m.title;
          chip.title = m.rating != null ? `Your rating: ${m.rating}★` : "Low rated";
          cold.appendChild(chip);
        });
      } else {
        cold.textContent = "Nothing rated under 3★ — generous viewer.";
      }
    }
  }

  async function setupTmdbSettings() {
    const form = document.getElementById("tmdb-form");
    const keyInput = document.getElementById("tmdb-key");
    const saveBtn = document.getElementById("tmdb-save-btn");
    const clearBtn = document.getElementById("tmdb-clear-btn");
    const statusText = document.getElementById("tmdb-status-text");
    const tag = document.getElementById("tmdb-tag");
    const headerStatus = document.getElementById("tmdb-status");
    if (!form) return;

    async function refreshStatus() {
      let configured = false;
      try {
        const res = await chrome.runtime.sendMessage({ type: "CINEGRAPH_TMDB_GET_STATUS" });
        configured = Boolean(res?.configured);
      } catch { configured = false; }
      if (tag) tag.textContent = configured ? "TMDB CONNECTED" : "NOT CONNECTED";
      if (headerStatus) headerStatus.textContent = configured ? "LOCAL + TMDB" : "LOCAL";
      if (clearBtn) clearBtn.hidden = !configured;
      if (statusText) {
        statusText.textContent = configured
          ? "TMDB connected — posters, overviews and ratings appear on every score."
          : "Optional — TMDB adds posters, overviews and ratings. Scores work without it.";
      }
      return configured;
    }

    await refreshStatus();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = keyInput.value.trim();
      if (!key) {
        statusText.textContent = "Paste a TMDB API key first.";
        return;
      }
      saveBtn.disabled = true;
      statusText.textContent = "Connecting to TMDB…";
      try {
        const res = await chrome.runtime.sendMessage({ type: "CINEGRAPH_TMDB_SET_KEY", apiKey: key });
        if (res?.ok) {
          keyInput.value = "";
          await refreshStatus();
          recommendations.innerHTML = "";
          loadRecommendations(feedbackData);
        } else {
          statusText.textContent = res?.message || "Could not validate that key.";
        }
      } catch (err) {
        statusText.textContent = "Could not reach the background worker. Reload the extension.";
        console.error("CineGraph TMDB save error:", err);
      } finally {
        saveBtn.disabled = false;
      }
    });

    clearBtn?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CINEGRAPH_TMDB_CLEAR_KEY" });
      await refreshStatus();
      recommendations.innerHTML = "";
      loadRecommendations(feedbackData);
    });
  }

  /**
   * Recommendations from the user's own watchlist, ranked by Letterboxd
   * affinity in the worker. TMDB enrichment adds posters when configured —
   * the ranking and reasons are always real library data.
   */
  async function loadRecommendations(feedback) {
    const label = document.getElementById("rec-source-label");
    const footer = document.getElementById("footer-source");
    try {
      const res = await chrome.runtime.sendMessage({
        type: "CINEGRAPH_GET_RECOMMENDATIONS",
        count: 8,
      });
      if (!res?.ok || !res.results?.length) {
        throw new Error(res?.message || "No recommendations.");
      }
      if (label) {
        label.textContent = res.tmdbEnriched
          ? "YOUR WATCHLIST · TMDB ARTWORK"
          : "YOUR WATCHLIST · RANKED";
      }
      const rated = await profileRatedCount();
      if (footer) footer.textContent = `Your Letterboxd library${rated ? ` · ${rated} rated` : ""} · Metadata by TMDB`;
      res.results.forEach((movie) => renderRecommendation(movie, feedback));
    } catch (err) {
      console.error("CineGraph recommendations error:", err);
      if (label) label.textContent = "WATCHLIST UNAVAILABLE";
      recommendations.innerHTML = "<p class=\"muted small\">Could not rank your watchlist. Reload the extension and try again.</p>";
    }
  }

  async function profileRatedCount() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "CINEGRAPH_GET_PROFILE" });
      return res?.profile?.stats?.rated || null;
    } catch { return null; }
  }

  function renderRecommendation(movie, feedback) {
    const key = `${movie.raw_title}|||${movie.year ?? ""}`;
    if (feedback[key] === "dismissed") return;
    const tmdb = movie.tmdb || null;
    const title = movie.raw_title || "Unknown";
    const year = movie.year ?? tmdb?.year ?? null;
    const overview = tmdb?.overview || "";
    const rating = tmdb?.rating ?? null;
    const genres = Array.isArray(tmdb?.genres) ? tmdb.genres.slice(0, 3) : [];
    const poster = tmdb?.poster || tmdb?.poster_small || null;

    const card = document.createElement("article");
    card.className = "recommendation tmdb-card";

    const top = document.createElement("div");
    top.className = "movie-top";

    const titleWrap = document.createElement("div");
    titleWrap.className = "movie-title";
    titleWrap.textContent = title;
    if (year) {
      const y = document.createElement("span");
      y.className = "movie-year";
      y.textContent = ` (${year})`;
      titleWrap.appendChild(y);
    }

    const badge = document.createElement("span");
    badge.className = "match";
    if (movie.band === "Possible Match") badge.classList.add("possible");
    if (movie.band === "Weak Match") badge.classList.add("weak");
    badge.textContent = movie.band || "Possible Match";
    top.append(titleWrap, badge);

    card.appendChild(top);

    if (tmdb && (poster || overview || rating != null)) {
      const meta = document.createElement("div");
      meta.className = "tmdb-meta";

      if (poster) {
        const img = document.createElement("img");
        img.className = "tmdb-poster";
        img.src = poster;
        img.alt = `${title} poster`;
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove());
        meta.appendChild(img);
      }

      const info = document.createElement("div");
      info.className = "tmdb-info";

      const bits = [];
      if (rating != null) bits.push(`★ ${rating}/10`);
      if (tmdb.votes) bits.push(`${Number(tmdb.votes).toLocaleString()} votes`);
      if (genres.length) bits.push(genres.join(" · "));
      if (bits.length) {
        const m = document.createElement("div");
        m.className = "tmdb-bits";
        m.textContent = bits.join("  •  ");
        info.appendChild(m);
      }
      if (overview) {
        const o = document.createElement("p");
        o.className = "reason tmdb-overview";
        o.textContent = overview.length > 220 ? overview.slice(0, 220) + "…" : overview;
        info.appendChild(o);
      }
      if (movie.reason) {
        const why = document.createElement("p");
        why.className = "reason tmdb-why";
        why.textContent = `Why it matches: ${movie.reason}`;
        info.appendChild(why);
      }
      meta.appendChild(info);
      card.appendChild(meta);
    } else if (movie.reason) {
      const reason = document.createElement("p");
      reason.className = "reason";
      reason.textContent = movie.reason;
      card.appendChild(reason);
    }

    // Expandable feedback (preserved behaviour).
    const details = document.createElement("div");
    details.className = "movie-details";
    details.hidden = true;
    const detailText = document.createElement("p");
    detailText.className = "reason";
    detailText.textContent = `Why it matches: ${movie.reason || overview || "—"}`;
    const feedbackEl = document.createElement("div");
    feedbackEl.className = "feedback";
    const interestedBtn = document.createElement("button");
    interestedBtn.textContent = "👍 Interested";
    const dismissBtn = document.createElement("button");
    dismissBtn.textContent = "👎 Not for me";

    function updateFeedbackButtons() {
      interestedBtn.textContent = feedback[key] === "interested" ? "✓ Interested" : "👍 Interested";
      dismissBtn.textContent = feedback[key] === "dismissed" ? "✓ Not for me" : "👎 Not for me";
    }
    interestedBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      feedback[key] = "interested";
      await chrome.storage.local.set({ movieFeedback: feedback });
      updateFeedbackButtons();
    });
    dismissBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      feedback[key] = "dismissed";
      await chrome.storage.local.set({ movieFeedback: feedback });
      card.remove();
    });
    updateFeedbackButtons();
    feedbackEl.append(interestedBtn, dismissBtn);
    details.append(detailText, feedbackEl);
    card.append(details);

    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-expanded", "false");
    function toggleDetails() {
      details.hidden = !details.hidden;
      card.setAttribute("aria-expanded", String(!details.hidden));
    }
    top.addEventListener("click", toggleDetails);
    top.style.cursor = "pointer";
    top.setAttribute("role", "button");
    top.tabIndex = 0;
    top.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleDetails();
      }
    });

    recommendations.appendChild(card);
  }

  // ── Consent gating ─────────────────────────────────────────────────────
  function updateActionButtons() {
    const canAnalyze = analysisConsent?.checked;
    analyzePageBtn.disabled = !canAnalyze;
    watchScreenBtn.disabled = !canAnalyze;
  }

  updateActionButtons();
  analysisConsent.addEventListener("change", updateActionButtons);

  // ── Watch Screen button ────────────────────────────────────────────────
  watchScreenBtn.addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("userConsent");
    if (!stored.userConsent?.analysis) {
      watchScreenStatus.textContent = "Please check the consent box first.";
      watchScreenStatus.style.color = "#e56b6b";
      return;
    }

    watchScreenBtn.disabled = true;
    watchScreenStatus.textContent = "Detecting titles from page...";
    watchScreenStatus.style.color = "#a3a3a3";
    watchScreenResults.hidden = true;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ["content/screen-detector.js"],
      });
      chrome.tabs.sendMessage(tabs[0].id, { type: "CINEGRAPH_WATCH_SCREEN" });
      watchScreenStatus.textContent = "Watching screen... (checking for movie titles)";
    } catch (err) {
      console.error("CineGraph: Watch screen failed:", err);
      watchScreenStatus.textContent = "Failed to watch screen. Check console.";
      watchScreenStatus.style.color = "#e56b6b";
      watchScreenBtn.disabled = false;
    }
  });

  // ── Listen for screen detection results ────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CINEGRAPH_DETECTED_TITLES") {
      displayScreenResults(message.titles);
    }
  });

  function displayScreenResults(titles) {
    watchScreenStatus.hidden = true;
    watchScreenResults.hidden = false;
    if (titles.length === 0) {
      watchScreenResults.innerHTML = "<p>No movie titles detected on this page.</p>";
      return;
    }
    let html = `<h4>${titles.length} title${titles.length !== 1 ? "s" : ""} detected:</h4>`;
    titles.forEach((title) => {
      const yearInfo = title.year ? ` (${title.year})` : "";
      html += `
        <div style="margin: 6px 0; padding: 4px 8px; background: #3a0d6b; border-radius: 4px;">
          <span style="color: #e1bEE6; font-weight: 600;">${title.raw_title}${yearInfo}</span>
        </div>
      `;
    });
    watchScreenResults.innerHTML = html;
    watchScreenResults.style.display = "block";
  }

  // ── Manual title lookup ────────────────────────────────────────────────
  manualTitleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("manual-title");
    const yearInput = document.getElementById("manual-year");
    const title = titleInput.value.trim();
    const year = yearInput.value.trim() || null;
    if (!title) return;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "CINEGRAPH_SCORE_MANUAL_TITLES",
        titles: [{ raw_title: title, year: year, source: "manual-entry" }],
      });
      if (result?.ok) {
        const manualResults = document.getElementById("manual-results");
        manualResults.hidden = false;
        manualResults.innerHTML = `
          <div style="background: #3a0d6b; padding: 12px; border-radius: 6px; color: #e1bEE6;">
            <strong>${result.titles.length} title${result.titles.length !== 1 ? "s" : ""} scored.</strong>
          </div>
        `;
      }
    } catch (err) {
      console.error("CineGraph: Manual score failed:", err);
    }
    titleInput.value = "";
    yearInput.value = "";
  });
}

loadCineGraph();

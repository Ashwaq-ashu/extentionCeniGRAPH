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

  try {
    const response = await fetch(
      chrome.runtime.getURL("mock-data.json")
    );

    if (!response.ok) {
      throw new Error("Could not load mock data");
    }

    const data = await response.json();

    document.getElementById("user-name").textContent =
      data.profile.name;

    data.profile.favoriteMovies.forEach((movie) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = movie;
      favorites.appendChild(chip);
    });

    data.profile.tasteDNA.forEach((trait) => {
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

    data.recommendations.forEach((movie) => {
      if (feedbackData[movie.title] === "dismissed") {
        return;
      }
      const card = document.createElement("article");
      card.className = "recommendation";

      const top = document.createElement("div");
      top.className = "movie-top";

      const title = document.createElement("div");
      title.className = "movie-title";
      title.textContent = movie.title;

      const year = document.createElement("span");
      year.className = "movie-year";
      year.textContent = ` (${movie.year})`;
      title.appendChild(year);

      const badge = document.createElement("span");
      badge.className = "match";

      if (movie.match === "Possible Match") {
        badge.classList.add("possible");
      }

      badge.textContent = movie.match;
      top.append(title, badge);

      const reason = document.createElement("p");
      reason.className = "reason";
      reason.textContent = movie.reason;

      
      const details = document.createElement("div");
      details.className = "movie-details";
      details.hidden = true;

      const detailText = document.createElement("p");
      detailText.className = "reason";
      detailText.textContent = `Why it matches: ${movie.reason}`;

      const feedback = document.createElement("div");
      feedback.className = "feedback";

      const interestedBtn = document.createElement("button");
      interestedBtn.textContent = "👍 Interested";

      const dismissBtn = document.createElement("button");
      dismissBtn.textContent = "👎 Not for me";
      
const movieKey = movie.title;

function updateFeedbackButtons() {
  interestedBtn.textContent =
    feedbackData[movieKey] === "interested"
      ? "✓ Interested"
      : "👍 Interested";

  dismissBtn.textContent =
    feedbackData[movieKey] === "dismissed"
      ? "✓ Not for me"
      : "👎 Not for me";
}

interestedBtn.addEventListener("click", async (event) => {
  event.stopPropagation();

  feedbackData[movieKey] = "interested";

  await chrome.storage.local.set({
    movieFeedback: feedbackData
  });

  updateFeedbackButtons();
});

dismissBtn.addEventListener("click", async (event) => {
  event.stopPropagation();

  feedbackData[movieKey] = "dismissed";

  await chrome.storage.local.set({
    movieFeedback: feedbackData
  });

  card.remove();
});

updateFeedbackButtons();

      feedback.append(interestedBtn, dismissBtn);
      details.append(detailText, feedback);

      card.append(top, details);

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

    });
  } catch (error) {
    document.getElementById("user-name").textContent =
      "Profile unavailable";

    favorites.textContent = "Could not load demo data.";
    console.error("CineGraph error:", error);
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
    // Check consent
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
      // Inject screen detector and watch for titles
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ["content/screen-detector.js"],
      });

      // Send message to start detection
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "CINEGRAPH_WATCH_SCREEN",
      });

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
        // Show results in manual-results div
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
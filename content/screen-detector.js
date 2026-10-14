/**
 * Screen Detector — extracts text from the page and detects movie titles.
 * Runs in the page context after explicit user-triggered injection.
 * Updated to capture text from ALL visible elements across all platforms.
 */

const BADGE_CLASS = "cinegraph-screen-detected";

/**
 * Patterns that commonly match movie titles.
 * These are simplistic heuristics — adjust as needed for your use case.
 * Pattern 1: "Movie Title (Year)" - classic format
 * Pattern 2: Title with possible year in brackets
 * Pattern 3: Just the title
 * Pattern 4: Title with year separated by space
 */
const MOVIE_TITLE_PATTERNS = [
  // "Movie Title (2020)" or "Movie Title (2020)" - most common
  /^(.+?)\s*\((\d{4})\)\s*$/,
  // "Movie Title 2020" - title followed by year
  /^(.+?)\s*(\d{4})\s*$/,
  // "Movie Title [2020]" - title with year in brackets
  /^(.+?)\s*\[(\d{4})\]\s*$/,
  // Just the title (last resort - must be at least 3 chars)
  /^(.{3,100})$/,
];

/**
 * Tries to extract a movie title from a given text string.
 * Returns { title, year } or null.
 * Strips leading/trailing whitespace and common non-title prefixes.
 */
function detectMovieTitle(text) {
  if (!text || typeof text !== "string") return null;

  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 200) return null;

  // Remove common prefixes that aren't part of the title
  let titleText = trimmed;
  const prefixesToRemove = [
    /^(the|a|an)\s+/i,
    /^\d+\s*/,
    /^(movie|film)\s+/i,
  ];

  for (const prefix of prefixesToRemove) {
    titleText = titleText.replace(prefix, "").trim();
  }

  if (titleText.length < 3) return null;

  // Try each pattern
  for (const pattern of MOVIE_TITLE_PATTERNS) {
    const match = titleText.match(pattern);
    if (match) {
      const rawTitle = match[1]?.trim();
      const year = match[2] ? parseInt(match[2], 10) : null;

      // Filter: title should be reasonable length and contain letters
      if (!rawTitle) continue;
      if (rawTitle.length < 3 || rawTitle.length > 100) continue;
      // Must contain at least some letters (not just numbers/symbols)
      if (!/[a-zA-Z]/.test(rawTitle)) continue;

      return { raw_title: rawTitle, year };
    }
  }

  // Final fallback: if the text itself looks like a title
  if (trimmed.length >= 3 && trimmed.length <= 100 && /[a-zA-Z]/.test(trimmed)) {
    return { raw_title: trimmed, year: null };
  }

  return null;
}

/**
 * Extracts text from ALL visible elements on the page and searches for movie titles.
 * Uses a broader set of selectors and also captures the body's full text.
 * Returns an array of detected movie info objects.
 */
async function extractAndDetectTitles() {
  const allText = [];

  // Strategy 1: Collect text from a wide range of elements
  // This covers headings, paragraphs, list items, form elements, etc.
  const selectors = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "span", "div",
    "a", "button", "label",
    "li", "td", "th",
    "input", "textarea",
    "small", "strong", "em", "u", "s",
    "section", "article", "footer", "header",
    "nav", "main", "aside",
  ];

  // Collect text from each selector group
  selectors.forEach((sel) => {
    const elements = document.querySelectorAll(sel);
    elements.forEach((el) => {
      if (el.offsetParent !== null) { // element is visible
        const text = el.textContent?.trim();
        if (text && text.length > 0) {
          // Skip elements that are likely navigation/boilerplate
          if (shouldSkipElement(el)) return;
          allText.push(text);
        }
      }
    });
  });

  // Strategy 2: Get the full body text (but limit length)
  try {
    const bodyText = document.body?.textContent?.trim();
    if (bodyText && bodyText.length > 0 && bodyText.length < 5000) {
      // Only add if it's notably different from collected elements
      const alreadyHave = allText.some(
        (t) => t.toLowerCase() === bodyText.toLowerCase().substring(0, 100)
      );
      if (!alreadyHave) {
        allText.push(bodyText.substring(0, 2000)); // Limit to 2000 chars
      }
    }
  } catch {}

  // 3. Search for movie titles in collected text
  const detected = [];

  // Remove duplicates early by normalizing
  const uniqueTexts = [...new Set(allText)];

  uniqueTexts.forEach((text) => {
    const result = detectMovieTitle(text);
    if (result) {
      // Check for duplicates (case-insensitive title comparison)
      const alreadyFound = detected.some(
        (d) => d.raw_title.toLowerCase() === result.raw_title.toLowerCase()
      );
      if (!alreadyFound) {
        detected.push(result);
      }
    }
  });

  // Also try: look for title patterns in longer text chunks
  // Split long text into phrases and check each
  allText.forEach((text) => {
    // Split by common delimiters
    const phrases = text.split(/[.!?,;:\s]+/);
    phrases.forEach((phrase) => {
      const result = detectMovieTitle(phrase);
      if (result) {
        const alreadyFound = detected.some(
          (d) => d.raw_title.toLowerCase() === result.raw_title.toLowerCase()
        );
        if (!alreadyFound) {
          detected.push(result);
        }
      }
    });
  });

  return detected;
}

/**
 * Checks if an element should be skipped during text collection.
 * Skips elements that are typically part of UI chrome, navigation, etc.
 */
function shouldSkipElement(el) {
  // Skip elements with very common non-title classes/ids
  const classList = el.className?.toLowerCase() || "";
  const id = el.id?.toLowerCase() || "";

  const skipPatterns = [
    /nav/i,
    /menu/i,
    /footer/i,
    /sidebar/i,
    /advertisement/i,
    /cookie/i,
    /popup/i,
    /modal/i,
    /alert/i,
    /toast/i,
  ];

  return skipPatterns.some((pattern) => pattern.test(classList) || pattern.test(id));
}

/**
 * Creates a badge showing the detected movie title.
 */
function createBadge(titleInfo) {
  const badge = document.createElement("div");
  badge.className = BADGE_CLASS;
  badge.textContent = `🎬 ${titleInfo.raw_title}`;
  badge.title = `Detected movie: ${titleInfo.raw_title}${
    titleInfo.year ? ` (${titleInfo.year})` : ""
  }`;

  // Style the badge
  Object.assign(badge.style, {
    display: "inline-block",
    margin: "4px 6px",
    padding: "5px 8px",
    borderRadius: "6px",
    background: "#4a148c",
    color: "#c8a1ff",
    fontSize: "11px",
    fontWeight: "600",
    border: "1px solid #7b2cbf",
  });

  return badge;
}

/**
 * Main entry point: detect titles and display badges.
 */
async function watchScreenForTitles() {
  try {
    const titles = await extractAndDetectTitles();

    if (titles.length === 0) {
      // No titles found - show a subtle message
      const existing = document.querySelector(`.${BADGE_CLASS}`);
      if (existing) existing.remove();
      // Also clear the status area
      const existingBadgeArea = document.querySelector(
        ".cinegraph-screen-detected-badge-area"
      );
      if (existingBadgeArea) existingBadgeArea.remove();
      return;
    }

    // Remove any existing badges first
    const existingBadges = document.querySelectorAll(`.${BADGE_CLASS}`);
    existingBadges.forEach((b) => b.remove());

    // Remove any existing badge area
    const existingBadgeArea = document.querySelector(
      ".cinegraph-screen-detected-badge-area"
    );
    if (existingBadgeArea) existingBadgeArea.remove();

    // Add badges to the page header or a suitable location
    const header = document.querySelector(".header");
    if (header) {
      // Insert after the brand/logo area
      const brand = header.querySelector(".brand");
      if (brand) {
        // Create a container for detected titles
        let container = document.querySelector(
          ".cinegraph-detected-titles"
        );
        if (!container) {
          container = document.createElement("div");
          container.className = "cinegraph-detected-titles";
          Object.assign(container.style, {
            display: "flex",
            alignItems: "center",
            marginLeft: "12px",
          });
          brand.after(container);
        }

        // Add each title badge
        titles.forEach((titleInfo) => {
          const badge = createBadge(titleInfo);
          container.appendChild(badge);
        });
      }
    } else {
      // Fallback: create a badge area at top-fixed position
      const badgeArea = document.createElement("div");
      badgeArea.className = "cinegraph-screen-detected-badge-area";
      badgeArea.style = `
        position: fixed;
        top: 20px;
        left: 20px;
        background: #4a148c;
        color: #c8a1ff;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 90%;
      `;
      badgeArea.innerHTML = `
        <strong>CineGraph Screen Watch</strong><br/>
        ${titles
          .map(
            (t) =>
              `${t.raw_title}${
                t.year ? ` (${t.year})` : ""
              }`
          )
          .join(" | ")}
        <div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">
          Click the side panel for more details
        </div>
      `;
      document.body.appendChild(badgeArea);
    }

    // Send message back to background/panel with results
    chrome.runtime.sendMessage({
      type: "CINEGRAPH_DETECTED_TITLES",
      titles: titles.map((t) => ({
        raw_title: t.raw_title,
        year: t.year,
        source: "screen-detector",
      })),
    });

    console.log("CineGraph: Detected titles from screen:", titles);
  } catch (err) {
    console.error("CineGraph: Screen detection failed:", err);
  }
}

// Listen for messages from the sidepanel/background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CINEGRAPH_WATCH_SCREEN") {
    watchScreenForTitles();
    return true; // keep message channel open
  }
  return false;
});

// Also auto-run when the script loads (if page has titles)
// - UI requires explicit trigger, but listener is set up
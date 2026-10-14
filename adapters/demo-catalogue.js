/**
 * Adapter for the local CineGraph demo movie catalogue (our own markup).
 * Does not target third-party streaming sites.
 */

globalThis.CineGraphDemoCatalogueAdapter = {
  id: "demo-catalogue",

  canHandle(urlString) {
    try {
      const url = new URL(urlString);
      // Only http/https on localhost or 127.0.0.1.
      // Live Server can serve from / or any path, so we accept all local http pages.
      // extract() returns [] if no [data-movie-card] elements are found, so non-matching
      // pages are harmless — the adapter simply reports "no titles found".
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      );
    } catch {
      return false;
    }
  },

  extract(documentRoot) {
    const root = documentRoot || document;
    const cards = [...root.querySelectorAll("[data-movie-card]")];
    const titles = [];
    const seen = new Set();

    cards.forEach((card) => {
      const titleElement = card.querySelector("[data-movie-title]");
      const yearElement = card.querySelector("[data-movie-year]");

      if (!titleElement) {
        return;
      }

      const raw_title = titleElement.textContent.trim();
      const yearText = yearElement?.textContent.trim() || null;

      if (!raw_title || seen.has(raw_title)) {
        return;
      }

      seen.add(raw_title);

      let year = null;
      if (yearText) {
        const parsed = Number.parseInt(yearText, 10);
        year = Number.isFinite(parsed) ? parsed : null;
      }

      titles.push({
        raw_title,
        year,
        source: "demo-catalogue",
        cardElement: card,
        titleElement,
      });
    });

    return titles;
  },
};

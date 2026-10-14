/**
 * Generic fallback adapter — handles any http(s) page without a dedicated adapter.
 * Prioritizes actual movie/show tiles: img alt, card headings, aria-labels.
 * Filters out UI chrome (section headers, nav, metadata like "1 Season").
 */

globalThis.CineGraphGenericAdapter = {
  id: "generic",

  canHandle(urlString) {
    try {
      const url = new URL(urlString);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },

  extract(documentRoot) {
    const root = documentRoot || document;
    const out = [];
    const seen = new Set();

    function parseYear(s) {
      if (!s) return null;
      const m = String(s).match(/(19|20)\d{2}/);
      return m ? parseInt(m[0], 10) : null;
    }

    // --- UI-chrome filter: section headers, nav, metadata ---
    function isUiChrome(text) {
      if (!text) return true;
      const t = text.trim().replace(/\s+/g, " ");
      if (t.length < 2 || t.length > 80) return true;
      if (!/[a-zA-Z]/.test(t)) return true;
      const low = t.toLowerCase();
      // Exact UI labels
      if (/^(home|search|tv|movies|shows?|series|sports|originals|premium|my space|watchlist|login|subscribe|settings|help|profile|see all|view all|watch now|watch trailer|more info|play|download)$/i.test(t)) return true;
      // Section-header phrases
      if (/(continue watching|new on|trending now|popular|top 10|because you|recently added|recommended for|watchlist|for you|continue for)/i.test(t)) return true;
      // Personalized rails contain a username: "Continue Watching for adilahmed"
      if (/^continue watching for\s+/i.test(t)) return true;
      // Metadata rows: "2026 • U/A 16+ • 1 Season • 4 Languages"
      if (/u\/a|season|episode|language|minutes|hrs?|min\b/i.test(t) && /•|\d+\s*(season|language|episode|min)/i.test(t)) return true;
      if (/^\d{4}\s*•/.test(t)) return true;
      // Domain / brand echoes
      if (/^(jiohotstar|hotstar|netflix|prime video|imdb|disney\+?)$/i.test(t)) return true;
      if (/^(new on jiohotstar|jiohotstar)$/i.test(t)) return true;
      return false;
    }

    function cleanTitle(raw) {
      if (!raw || typeof raw !== "string") return null;
      let c = raw.trim().replace(/\s+/g, " ");
      // Take first line only (tiles often concat title + meta)
      c = c.split("\n")[0].trim();
      // Strip site suffixes
      c = c.split(" - ")[0].split(" | ")[0].split(" – ")[0].trim();
      // Strip trailing year in parens, keep year separately
      const ym = c.match(/^(.+?)\s*\((\d{4})\)\s*$/);
      if (ym) return { title: ym[1].trim(), year: parseInt(ym[2], 10) };
      return { title: c, year: null };
    }

    // --- Site chrome exclusion: never treat nav/header/sidebar as titles ---
    function inSiteChrome(el) {
      try {
        return !!el?.closest?.(
          "nav, header, aside, [role='navigation'], [role='banner'], [role='complementary'], [class*='sidebar'], [class*='topnav'], [class*='navbar'], [class*='site-header']"
        );
      } catch { return false; }
    }

    function push(raw, yearHint, source, titleElement, cardElement, catalogueId) {
      const parsed = cleanTitle(raw);
      if (!parsed || !parsed.title) return;
      if (isUiChrome(parsed.title)) return;
      // Sidebar / top-nav icons and labels are site chrome, not movies.
      if (inSiteChrome(titleElement) || inSiteChrome(cardElement)) return;
      const year = parsed.year ?? yearHint ?? null;
      const key = globalThis.CineGraphStableId
        ? globalThis.CineGraphStableId.stableKey({ catalogue_id: catalogueId || null, raw_title: parsed.title, year })
        : parsed.title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: key,
        catalogue_id: catalogueId || null,
        raw_title: parsed.title,
        year,
        source: source || "generic",
        pageMeta: getMetaFor(titleElement || cardElement),
        titleElement: titleElement || null,
        cardElement: cardElement || null,
      });
    }

    // Capture on-page context shown around the tile:
    // e.g. tag "NEWLY ADDED" / "NEW SEASON", rail heading "Watchlist".
    function getMetaFor(el) {
      try {
        if (!el) return null;
        const card = el.closest("a, article, li, [class*='card'], [class*='tile'], [class*='poster']") || el.parentElement;
        const cardText = (card?.textContent || "").slice(0, 400);
        let tag = null;
        const tagM = cardText.match(/NEWLY ADDED|NEW SEASON|NEW EPISODES?|PREMIERE|EXCLUSIVE|LATEST|TRENDING|TOP 10/gi);
        if (tagM) tag = tagM[0].toUpperCase();
        // Rail / section heading: nearest section-level h2
        let section = null;
        let scope = el;
        for (let i = 0; i < 5 && scope; i += 1) {
          scope = scope.parentElement;
          const h = scope?.querySelector?.(":scope > h2, :scope > h3, :scope > div > h2");
          if (h && h.textContent && !isUiChrome(h.textContent) === false) {
            // h2 here is a section header like "Watchlist" — keep it even though
            // isUiChrome() rejects rail headers as titles.
            const t = h.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
            if (t.length >= 2 && t.length <= 60 && !/continue watching for/i.test(t)) { section = t; break; }
          }
        }
        if (!section) {
          // Fallback: previous heading sibling
          const prev = card?.parentElement?.previousElementSibling;
          if (prev && /^(H1|H2|H3)$/.test(prev.tagName)) section = prev.textContent.trim().slice(0, 60);
        }
        if (!tag && !section) return null;
        return { tag: tag || null, section: section || null };
      } catch { return null; }
    }

    function yearNear(el) {
      try {
        if (!el) return null;
        const scope = el.closest("article, li, [class*='card'], [class*='tile'], [class*='poster'], [class*='slider'], section, div") || el.parentElement;
        const txt = scope?.textContent?.slice(0, 500) || "";
        return parseYear(txt);
      } catch { return null; }
    }

    // 1. Explicit demo-style markup (reused anywhere)
    root.querySelectorAll("[data-movie-card]").forEach((card) => {
      const t = card.querySelector("[data-movie-title]");
      const y = card.querySelector("[data-movie-year]");
      const cid = card.getAttribute("data-catalogue-id") || card.getAttribute("data-title-id") || null;
      if (t) push(t.textContent, parseYear(y?.textContent), "generic-markup", t, card, cid);
    });

    // 2. Poster images: <img alt="Lanterns"> — best signal on Hotstar/Netflix/IMDb.
    // Includes lazy-loaded tiles (data-src) and <picture> sources: the <img> node
    // is present in the DOM even before it scrolls into the viewport.
    root.querySelectorAll("img[alt], picture img[alt]").forEach((img) => {
      const alt = img.getAttribute("alt")?.trim();
      if (!alt || alt.length < 2 || alt.length > 70) return;
      // Skip logos/icons
      if (/logo|icon|avatar|profile|search|play|close|menu/i.test(alt) && alt.length < 20) {
        // still allow if it looks like a title? logos usually short — skip
        if (!/^[A-Z][a-z]+(\s[A-Z][a-z]+)*$/.test(alt)) return;
      }
      const card = img.closest("a, article, li, [class*='card'], [class*='tile'], [class*='poster'], [data-testid], div");
      const cid = card?.getAttribute?.("data-catalogue-id") || card?.getAttribute?.("data-title-id") || img.getAttribute("data-catalogue-id") || null;
      push(alt, yearNear(img), "generic-poster", img, card, cid);
    });

    // 3. Accessible labels on tiles: <a aria-label="The Mummy" title="...">
    // Also picks up role="link" tiles and data-testid title nodes used by
    // virtualized rails (present in DOM before they become visible).
    root.querySelectorAll("a[aria-label], button[aria-label], a[title], [role='link'][aria-label], [data-testid*='title'], [data-testid*='card']").forEach((el) => {
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || (el.dataset?.testid ? null : null);
      const text = label || (el.children.length === 0 ? el.textContent : null);
      if (!text || text.length > 70) return;
      const cid = el.getAttribute?.("data-catalogue-id") || el.getAttribute?.("data-title-id") || null;
      push(text, yearNear(el), "generic-label", el, el.closest("article, li, div"), cid);
    });

    // 4. Card headings: h3/h4/h5 inside links, list items, cards.
    // Scoped to cards/tiles so rail section headers (h2) are never collected.
    root.querySelectorAll("a h3, a h4, a h5, li h3, li h4, article h3, article h4, [class*='card'] h3, [class*='card'] h4, [class*='tile'] h3, [class*='tile'] h4, [class*='poster'] h3, [data-testid] h3, [data-testid] h4").forEach((el) => {
      const cid = el.closest("a, article, li, div")?.getAttribute?.("data-catalogue-id") || null;
      push(el.textContent, yearNear(el), "generic-card", el, el.closest("a, article, li, div"), cid);
    });

    // 5. JSON-LD Movie blocks
    try {
      root.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try {
          const json = JSON.parse(s.textContent);
          const items = Array.isArray(json) ? json : [json];
          items.forEach((item) => {
            const graph = item["@graph"] || [item];
            (Array.isArray(graph) ? graph : [graph]).forEach((node) => {
              if (node["@type"] === "Movie" || node["@type"] === "TVSeries" || node["@type"] === "Film") {
                if (node.name) push(node.name, parseYear(node.dateCreated), "generic-jsonld", null, null);
              }
            });
          });
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    // 6. Hero title (page's own h1) — e.g. "LANTERNS" hero on Hotstar
    const h1 = root.querySelector("h1");
    if (h1 && out.length < 5) {
      push(h1.textContent, yearNear(h1) || parseYear(root.body?.textContent?.slice(0, 2000)), "generic-hero", h1, null);
    }

    // 7. Last resort: og:title / document.title
    if (out.length === 0) {
      const og = root.querySelector('meta[property="og:title"]')?.content || root.title;
      if (og) push(og, null, "generic-title", null, null, null);
    }

    // Cap raised for scrolled rails: first scan often yields ~30 tiles and the
    // old cap truncated newly appended cards on Recheck. 100 keeps payloads sane.
    return out.slice(0, 100);
  },
};

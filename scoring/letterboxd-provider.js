/**
 * Letterboxd-backed scoring provider (local, on-device).
 * Scores every title against the user's real Letterboxd library via
 * CineGraphLetterboxdProfile — no placeholders, no invented traits.
 * Results are real affinity predictions from the user's own ratings;
 * `is_demo` is always false.
 */

globalThis.CineGraphLetterboxdProvider = {
  async score(payload) {
    const profile = globalThis.CineGraphLetterboxdProfile;
    if (!profile?.scoreTitle) {
      throw new Error("Letterboxd profile is not loaded.");
    }

    const results = [];
    const unresolved = [];

    for (const movie of payload.titles || []) {
      const title = String(movie.raw_title || "").trim();
      if (!title) continue;
      if (title.length < 2) {
        unresolved.push(title);
        continue;
      }

      const scored = profile.scoreTitle(title, movie.year ?? null);
      if (!scored) {
        unresolved.push(title);
        continue;
      }

      results.push({
        raw_title: title,
        catalogue_id: null,
        band: scored.band,
        reason: scored.reason,
        confidence: scored.score,
        is_demo: false,
      });
    }

    // Strong first so the panel reads as a ranked preference list.
    const rank = { "Strong Match": 0, "Possible Match": 1, "Weak Match": 2 };
    results.sort((a, b) => (rank[a.band] ?? 9) - (rank[b.band] ?? 9));

    return { results, unresolved };
  },
};

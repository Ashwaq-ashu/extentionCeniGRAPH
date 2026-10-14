/**
 * Development-only scoring provider.
 * Now taste-aware: matches each detected title against the mock viewer
 * profile (traits + most-watched) instead of hash-random bands.
 * Still deterministic + local. Swap to API mode when backend is ready.
 */

globalThis.CineGraphDevMockProvider = {
  async score(payload) {
    await new Promise((resolve) => setTimeout(resolve, 120));

    const profile = globalThis.CineGraphMockProfile;
    const results = [];
    const unresolved = [];

    for (const movie of payload.titles || []) {
      const title = movie.raw_title;
      if (!title) continue;
      if (title.length < 2) {
        unresolved.push(title);
        continue;
      }

      const scored = profile?.scoreTitle
        ? profile.scoreTitle(title)
        : { band: "Possible Match", top_traits: ["Mystery"], score: 0.5, reason: "Demo placeholder." };

      results.push({
        raw_title: title,
        catalogue_id: null,
        band: scored.band,
        top_traits: scored.top_traits,
        reason: scored.reason,
        confidence: scored.score,
        is_demo: true,
      });
    }

    // Strong first so the panel reads as a ranked preference list.
    const rank = { "Strong Match": 0, "Possible Match": 1, "Weak Match": 2 };
    results.sort((a, b) => (rank[a.band] ?? 9) - (rank[b.band] ?? 9));

    return { results, unresolved };
  },
};

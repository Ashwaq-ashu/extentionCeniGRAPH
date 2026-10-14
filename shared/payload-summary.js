/**
 * Builds a user-visible summary of what would be / was sent for scoring.
 * Never includes profile tokens or secrets.
 */

globalThis.CineGraphPayloadSummary = {
  fromTitles(titles, region, demoMode) {
    const safeTitles = (titles || []).map((entry) => ({
      raw_title: entry.raw_title,
      year: entry.year ?? null,
      source: entry.source || null,
    }));

    return {
      titleCount: safeTitles.length,
      region: region || "IN",
      demoMode: Boolean(demoMode),
      sendsNetworkRequest: !demoMode,
      dataFields: ["raw_title", "year", "source"],
      titles: safeTitles,
    };
  },
};

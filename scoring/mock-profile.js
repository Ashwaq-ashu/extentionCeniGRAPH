/**
 * Mock viewer profile + trait inference (demo only, no backend).
 * This is what makes detected titles score differently per "taste".
 * Replace with real API scoring later — same result shape.
 */

globalThis.CineGraphMockProfile = (() => {
  const user = {
    name: "Demo Viewer",
    traits: [
      { trait: "Psychological tension", level: "Strong", weight: 1.0 },
      { trait: "Mystery", level: "Strong", weight: 1.0 },
      { trait: "World-building", level: "Strong", weight: 0.9 },
      { trait: "Nonlinear storytelling", level: "Moderate", weight: 0.6 },
      { trait: "Emotional intensity", level: "Moderate", weight: 0.6 },
      { trait: "Action / Crime", level: "Moderate", weight: 0.55 },
      { trait: "Family / Drama", level: "Low", weight: 0.25 },
    ],
    mostWatched: [
      { title: "Daredevil", why: "Psychological tension + Action / Crime" },
      { title: "Supernatural", why: "Mystery + World-building" },
      { title: "Game Of Thrones", why: "World-building + Emotional intensity" },
      { title: "Interstellar", why: "World-building + Emotional intensity" },
      { title: "Shutter Island", why: "Mystery + Psychological tension" },
    ],
    // Low affinity buckets — these drag scores to Weak Match.
    coldGenres: ["Reality", "Sports", "Daily soap", "Episode clip"],
  };

  // Keyword → traits. Covers titles seen on Hotstar/IMDb in screenshots.
  const KEYWORDS = [
    { re: /mummy|supernatural|ghost|disclosure|awakening|mystery|haunt|train\b/i, traits: ["Mystery", "Psychological tension"] },
    { re: /daredevil|mobland|kanguva|infinite|gold|locked|loaded|peacemaker|mortal|kombat|watchmen/i, traits: ["Action / Crime", "Emotional intensity"] },
    { re: /avatar|mandalorian|grogu|thrones|lokah|chandra|lanterns|supernatural|marv|jane/i, traits: ["World-building", "Emotional intensity"] },
    { re: /inception|interstellar|prestige|shutter|memento|arrival|tenet|mirage|twist/i, traits: ["Nonlinear storytelling", "Mystery"] },
    { re: /bombay|stories|inspiration|answers?|hunting|jessica|brok/i, traits: ["Mystery", "Emotional intensity"] },
    { re: /gold|desert|history|epic|myth/i, traits: ["World-building", "Emotional intensity"] },
  ];

  const COLD_PATTERNS = [
    /^(s\d+\s*e\d+|e\d+|ep\d+|s20 e35|s1 e1|s2 e3)$/i,          // episode codes
    /\bday \d+\b/i, /bbhin|biggboss|bigg\s*boss/i,              // reality
    /bengal vs delhi|vs delhi|cricket|football|match highlights/i, // sports
    /abhir|pakhii|mahi|mihir|claim|shocks|doubts|face/i,        // daily-soap synopses
    /zip wire|bulletin|news/i,
  ];

  function traitWeight(name) {
    const t = user.traits.find((x) => x.trait === name);
    return t ? t.weight : 0.2;
  }

  function inferTraits(title) {
    const hits = [];
    for (const k of KEYWORDS) {
      if (k.re.test(title)) hits.push(...k.traits);
    }
    if (!hits.length) {
      // Deterministic fallback so every title gets traits (hash-based, stable).
      let h = 0;
      for (let i = 0; i < title.length; i += 1) h = (h + title.charCodeAt(i) * (i + 1)) | 0;
      const pool = ["Mystery", "World-building", "Psychological tension", "Emotional intensity", "Action / Crime", "Nonlinear storytelling"];
      hits.push(pool[Math.abs(h) % pool.length], pool[Math.abs(h + 3) % pool.length]);
    }
    return [...new Set(hits)].slice(0, 3);
  }

  function isCold(title) {
    return COLD_PATTERNS.some((re) => re.test(title));
  }

  function scoreTitle(rawTitle) {
    const title = String(rawTitle || "").trim();
    if (!title) return null;
    if (isCold(title)) {
      return {
        band: "Weak Match",
        top_traits: ["Family / Drama"],
        score: 0.1,
        reason: `Far from your usual Mystery / World-building picks (you rewatch ${user.mostWatched[1].title}, ${user.mostWatched[2].title}). Looks like Reality / Sports / episode-clip content.`,
      };
    }
    const traits = inferTraits(title);
    let score = traits.reduce((s, t) => s + traitWeight(t), 0);
    // Small boost for sequel/franchise of something rewatched
    if (user.mostWatched.some((m) => title.toLowerCase().includes(m.title.toLowerCase().split(" ")[0].toLowerCase()) && m.title.length > 4)) {
      score += 0.4;
    }
    const band = score >= 1.6 ? "Strong Match" : score >= 0.8 ? "Possible Match" : "Weak Match";
    const anchor = user.mostWatched[Math.abs(title.length) % user.mostWatched.length];
    const reason =
      band === "Strong Match"
        ? `Strong overlap with your ${traits.slice(0, 2).join(" + ")} taste (you rewatch ${anchor.title} — ${anchor.why}).`
        : band === "Possible Match"
          ? `Partial overlap: ${traits.slice(0, 2).join(" + ")} vs your Mystery / World-building core (cf. ${anchor.title}).`
          : `Low overlap with your ${user.traits[0].trait} / ${user.traits[1].trait} core; closest anchor is ${anchor.title}.`;
    return { band, top_traits: traits.slice(0, 2), score: Math.round(score * 100) / 100, reason };
  }

  return { user, inferTraits, scoreTitle };
})();

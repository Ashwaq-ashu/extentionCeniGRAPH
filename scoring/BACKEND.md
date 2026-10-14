# Connecting the real scoring API

The extension implements the **proposed** contract from the team handoff. Confirm every detail with your backend owner before production use.

## Endpoint (proposed)

`POST {baseUrl}/v1/extension/score`

### Request body

```json
{
  "profile_token": "...",
  "region": "IN",
  "titles": [{ "raw_title": "Interstellar", "year": 2014 }]
}
```

### Response body

```json
{
  "results": [
    {
      "raw_title": "Interstellar",
      "catalogue_id": null,
      "band": "Strong Match",
      "top_traits": ["Emotional intensity", "World-building"],
      "reason": "...",
      "confidence": 0.91
    }
  ],
  "unresolved": []
}
```

## Before enabling API mode

1. Confirm live **base URL**, auth scheme, CORS rules, error format, and rate limits.
2. Add the API host to `manifest.json`:

```json
"host_permissions": [
  "https://YOUR-CONFIRMED-API-HOST/*"
]
```

3. Reload the extension.

## Enable API mode (storage)

Run once in the **service worker** console (`chrome://extensions` → Inspect service worker):

```javascript
chrome.storage.local.set({
  scoringSettings: {
    mode: "api",
    baseUrl: "https://YOUR-CONFIRMED-API-HOST",
    profileToken: "USER-PROFILE-TOKEN-FROM-YOUR-AUTH-FLOW",
    region: "IN",
    authHeaderName: "Authorization",
    authHeaderValue: "Bearer OPTIONAL-IF-TEAM-CONFIRMS"
  }
});
```

Do **not** commit tokens or API keys into source control. Store them via your sign-in flow later.

## Switch back to development mock

```javascript
chrome.storage.local.set({
  scoringSettings: { mode: "dev-mock" }
});
```

## Client implementation

- Shared logic: `scoring/scoring-client.js`
- Dev placeholders: `scoring/mock-dev-provider.js` (deterministic, labeled **Demo ·** in UI)
- Page + manual scoring both use the same client interface.

# Site adapters

Each adapter implements:

- `id` — stable identifier
- `canHandle(urlString)` — whether this adapter may run on the URL
- `extract(documentRoot)` — returns normalized entries `{ raw_title, year, source, ... }`

Register new adapters in `registry.js` only after confirming the site's terms and an authorized access method (official API, licensed metadata, or user-provided input).

**Enabled:** `demo-catalogue` (local `localhost` / `127.0.0.1` demo pages).

**Manual entry (no adapter):** side panel **Look up a title** sends only user-typed metadata through the scoring client — use this when page extraction is not permitted.

**Not enabled:** third-party streaming or catalogue sites (IMDb, Hotstar, etc.) pending legal review.

## Adding a new adapter

1. Create `adapters/your-site.js` with `id`, `canHandle(url)`, `extract(document)`.
2. Register in `adapters/registry.js`.
3. Add the file to `INJECTED_FILES` in `background.js`.
4. Document the legal/access basis in this README before shipping.

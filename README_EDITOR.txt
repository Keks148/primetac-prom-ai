PrimeTac Post-Import Editor v2.0.0

Upload these files over the existing GitHub repository:
- package.json
- editor-server.js
- src/prom-editor.js

The existing src/config.js and src/prom.js remain in the repo and are reused.

Render env vars used:
PROM_EDITOR_ENABLED=true
PROM_EDITOR_APPLY=false   # dry-run first
PROM_EDITOR_INTERVAL_MINUTES=30
PROM_EDITOR_START_DELAY_SECONDS=120
PROM_EDITOR_STATE_PATH=/var/data/primetac-prom-editor-state.json

Rules:
- Keep clothing and footwear.
- LOWA and Helikon-Tex are blocked.
- Equipment/accessories named in the block list are marked not_available and quantity 0.
- Unknown items are REVIEW only and are never changed automatically.
- Existing long descriptions and sufficiently filled keywords are not overwritten.
- Empty groups are reported. Public Prom API exposes groups/list but not a group-delete endpoint, so group deletion is not attempted by this service.

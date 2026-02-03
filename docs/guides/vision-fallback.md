# Vision Fallback (Preview + Texture)

Primary: use render_preview and (if exposed) read_texture so the client can attach images directly.

Fallback: if the client cannot accept images, save snapshots to disk and upload manually.

Preview (auto + fallback):
```json
{
  "mode": "fixed",
  "output": "single",
  "angle": [30, 45, 0],
  "saveToTmp": true,
  "tmpPrefix": "preview"
}
```

Texture (auto + fallback):
```json
{
  "name": "pot_wood",
  "saveToTmp": true,
  "tmpPrefix": "texture"
}
```

Snapshots are saved under:
- <project_root>/.bbmcp/tmp

Cleanup:
- Delete files immediately after manual upload to avoid stale/large tmp files.

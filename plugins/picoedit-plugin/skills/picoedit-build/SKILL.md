---
name: picoedit-build
description: Help PicoEdit build local rough-cut videos from scripts, audio, templates, and assets. Use when the user asks Codex to generate timeline.json, edit_list.csv, rough_cut.mp4, align dialogue/audio timings, or verify video duration. In v1 of picoedit-plugin, do not implement script-to-JSON generation or new render behavior; use this only as a scoped guide and preserve existing rough-cut behavior.
---

# PicoEdit Build

## v1 Boundary

This skill is included so the plugin has the intended future shape, but v1 must not change PicoEdit build logic.

Do not implement these in v1:

- Script-to-JSON generation
- TTS generation
- ZIP download or extraction
- `asset_manifest.json` generation
- R2 publishing
- Changes to existing rough-cut render behavior

## Existing Outputs

When build work is explicitly requested in a later phase, preserve the current output contract:

```text
output\timeline.json
output\edit_list.csv
output\rough_cut.mp4
```

Use `ffprobe` to verify generated video duration when generation is actually performed.

## Response Style

For now, tell the user that v1 only verifies the R2 catalog path and that rough-cut generation remains unchanged.

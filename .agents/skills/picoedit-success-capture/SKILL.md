# picoedit-success-capture

Use this skill after `picoedit-render-verification` passes, or when preserving a useful run with clearly documented warnings.
The goal is to make Codex-created video output reproducible from repository evidence instead of conversation memory.

## Destination

Save each run under:

```text
runs/<run_id>/
```

Use a run id with date/time and a short content hint, for example:

```text
2026-07-05_201532_4296s_7segments
```

## Required Artifacts

Save or record at least:

- `manifest.json`
- `review.md`
- Copy of `output/timeline_with_captions.json`
- Copy of `output/rough_cut_plan.json`
- Copy of `output/asset_manifest_check.json`
- `selected_clips.json` list with file names, paths, sizes, mtimes, and hashes
- `output/rough_cut.mp4` path, size, mtime, and sha256
- `input/voice.mp3` path, duration, size, mtime, and sha256
- Archived source voice copy at `runs/<run_id>/input/voice.mp3`
- Execution timestamp
- Git commit SHA
- Codex judgment notes

Large video files do not have to be copied into `runs/`. Prefer path, size, mtime, and sha256 unless the user explicitly asks to archive media bytes. The voice file is small enough that successful runs must archive it locally under the run directory.

## Manifest Rules

`manifest.json` must include these top-level sections:

- `run_id`
- `created_at`
- `git_commit`
- `source_script`
- `voice`
- `timeline`
- `assets`
- `render`
- `quality`

If an artifact changed after the successful render, keep the current measured value and add a warning in both `manifest.json` and `review.md`.
Do not invent a passing value to hide stale or overwritten files.

The `voice` section must include:

```json
{
  "path_at_capture": "input/voice.mp3",
  "archived_copy": "runs/<run_id>/input/voice.mp3",
  "duration_sec": 0,
  "size_bytes": 0,
  "mtime_iso": "",
  "sha256": ""
}
```

The `quality` section must include:

```json
{
  "status": "pass",
  "voice_to_segment_diff_sec": 0,
  "voice_to_caption_diff_sec": 0,
  "voice_to_render_diff_sec": 0,
  "notes": []
}
```

Set `quality.status` to `pass` only when the source voice duration, final segment end, final caption cue end, and rough cut duration all agree within `0.1` seconds. If any required voice archive or timing check is missing or failing, use `needs_revalidation` instead.

## Review Rules

`review.md` should briefly record:

- What made the run successful.
- The exact verification numbers.
- Any warnings or artifact mismatches.
- Codex judgment notes about quality.
- Files copied into the run directory.
- Whether the archived voice copy exists and matches the manifest hash.

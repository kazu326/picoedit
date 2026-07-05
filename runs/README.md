# PicoEdit Runs

`runs/` is the place for successful examples, failed examples, and comparison results from Codex-led PicoEdit production.

PicoEdit output files under `output/` can be overwritten during later production attempts. A run record preserves the judgment evidence that made a result useful at the time it was captured.

Large video copies are not required. Track media by path, size, mtime, and sha256 unless a task explicitly requires archiving the bytes.

Successful runs must archive the source voice under `runs/<run_id>/input/voice.mp3`, because the working `input/voice.mp3` can be overwritten by later attempts.

Use `status: "pass"` only when the archived voice, `timeline_with_captions.json`, `selected_clips`, `rough_cut_plan.json`, and `rough_cut.mp4` are from the same generation. If the voice hash or timing does not match, use `status: "needs_revalidation"` and keep the run as an artifact reference, not a golden regression baseline.

Do not use old logs with unclear chronology, such as `output/roughcut_command_log.txt`, as a success baseline. Prefer the structured files in a run directory:

- `manifest.json`
- `review.md`
- `timeline_with_captions.json`
- `rough_cut_plan.json`
- `asset_manifest_check.json`
- `selected_clips.json`

If a current artifact no longer matches the captured run, record that as a warning instead of rewriting history.

When reviewing asset choices, use `.agents/skills/picoedit-asset-selection/SKILL.md` as the judgment guide. Record whether each asset matched the segment role/emotion or only matched a spoken keyword, and note long-segment loop quality when relevant.

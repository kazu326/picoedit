# 2026-07-05 42.96s 7 Segments Run

## Summary

This run captures the 42.96-second PicoEdit rough cut as an artifact reference.

Codex judgment: useful for inspecting timeline, caption, asset assignment, selected clips, and final rough cut. It is not a golden regression baseline because the original 42.96-second source voice is not archived and the current `input/voice.mp3` is 39.92 seconds.

## Verification

- `input/voice.mp3` duration: 39.92s current file, warning
- Final `segment.end`: 42.96s
- Final `caption_cue.end`: 42.96s
- `selected_clips` count: 7
- `rough_cut_plan.ok`: true
- `rough_cut.mp4` duration: 42.96s
- Voice to segment diff: 3.04s
- Voice to caption diff: 3.04s
- Voice to render diff: 3.04s
- Segment to render diff: 0s
- `asset_manifest_check.missing_count`: 0
- Recognized videos: 34
- Quality status: `needs_revalidation`

## Artifacts

- Timeline copy: `runs/2026-07-05_201532_4296s_7segments/timeline_with_captions.json`
- Rough cut plan copy: `runs/2026-07-05_201532_4296s_7segments/rough_cut_plan.json`
- Asset manifest check copy: `runs/2026-07-05_201532_4296s_7segments/asset_manifest_check.json`
- Selected clips list: `runs/2026-07-05_201532_4296s_7segments/selected_clips.json`
- Rough cut source: `output/rough_cut.mp4`
- Rough cut sha256: `9a7ef63028f9166979ae89ab113e290921ab466a761ae7185b65ea36aae7c345`
- Current voice source: `input/voice.mp3`
- Current voice sha256: `23a480a3d03e1117c412b1a5d504305390bea55b6139930bc96d0eb0a0794660`
- Archived source voice: not verified

## Notes

- The official time base for this run is `output/timeline_with_captions.json` `segments`.
- `roughcut_command_log.txt` was not used as the success baseline because its chronology does not match the current 42.96-second plan.
- Before reproducing this exact run, restore or regenerate a voice artifact whose duration and hash match the intended 42.96-second voice.
- This run may be used as an artifact reference, but not as a golden regression baseline.

# 2026-07-06 39.92s Golden Attempt

## Summary

Status: `needs_revalidation`

This attempt archived the current `input/voice.mp3` first, then ran the official production path through `merge-timestamps`. The run stopped at `scripts/generate_caption_cues.js`.

## Verification

- Archived voice duration: 39.92s
- Current `timeline.json` final `segment.end`: 39.92s
- New `timeline_with_captions.json`: not generated
- Existing stale `timeline_with_captions.json` final `segment.end`: 42.96s
- Existing stale `timeline_with_captions.json` final `caption_cue.end`: 42.96s
- `selected_clips`: not generated for this run
- `rough_cut.mp4`: not generated for this run
- Failure: `字幕尺が範囲外です: caption_010 0.96`

## Review Notes

- Good asset assignment: not evaluated because rendering did not run.
- Unnatural parts: not evaluated because rendering did not run.
- Loop usage and naturalness: not evaluated because rendering did not run.
- Subtitle/video drift: cannot validate; caption cue generation failed.
- Judgment to keep next time: archive `input/voice.mp3` before generation and reject stale 42.96s artifacts for this 39.92s input.
- Improvement candidates, not implemented now: investigate why the current 39.92s input produces a sub-1.2s `caption_010` cue in `generate_caption_cues.js`.

## Artifacts

- Archived voice: `runs/2026-07-06_000936_3992s_golden/input/voice.mp3`
- Current timeline copy: `runs/2026-07-06_000936_3992s_golden/timeline.json`
- Current script copy: `runs/2026-07-06_000936_3992s_golden/script_timed.json`
- Stale timeline-with-captions copy: `runs/2026-07-06_000936_3992s_golden/timeline_with_captions_stale.json`
- Error log: `runs/2026-07-06_000936_3992s_golden/caption_generation_error.txt`

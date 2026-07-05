# picoedit-regression-repair

Use this skill when PicoEdit output regresses or a previously successful render can no longer be reproduced.
Repair must be narrow and evidence-driven.

## Rules

1. Compare the latest successful `runs/<run_id>/` record with the current output before changing anything.
2. Do not use old loose logs, such as `output/roughcut_command_log.txt`, as the success baseline when their timeline is unclear.
3. Do not restore the old template route.
4. Do not use `templates/*.json`, `template.slots`, or `slot.target_duration` as the official time base.
5. If the cause is unclear, stop after documenting the investigation; do not chain speculative fixes.
6. After any repair, run `picoedit-render-verification`.
7. When the issue is understood, append a concise prevention rule to the relevant skill or run review.
8. If current `input/voice.mp3` does not match the successful run's archived voice hash, do not treat current output as a failed reproduction of that run. Treat it as a new run with a different input.

## Comparison Targets

Compare:

- `timeline_with_captions.json` segment count and final segment end.
- Caption cue count and final caption end.
- Asset manifest counts and missing files.
- Selected clip count and hashes when available.
- `rough_cut_plan.json` status, assignments, and duration.
- `rough_cut.mp4` duration, size, and hash.
- Successful run archived `input/voice.mp3` hash.
- Successful run voice duration.
- Current `input/voice.mp3` duration and hash.

## Voice Identity Rule

A regression comparison is valid only when the current source voice matches the successful run's archived voice hash. If the hashes differ, the current state may still be broken, but it is not evidence that the archived run regressed. Start a new run record or regenerate from the intended voice instead.

## Prevention Notes

- If Japanese caption splitting creates a non-final cue shorter than `1.2` seconds, first check whether it is a word-internal split that can be safely left-joined across a boundary gap of `0.05` seconds or less; never right-join across a long silence.

## Repair Boundary

Do not modify ElevenLabs, timestamp generation, `/api/script/merge-timestamps`, `generate_caption_cues.js`, `build_timeline_roughcut.js`, asset selection logic, FFmpeg settings, browser UI, or server API design unless the user explicitly scopes that change.

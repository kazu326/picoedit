# picoedit-production-run

Use this skill when Codex Desktop is acting as the production controller for PicoEdit.
The browser UI is a preview aid only; it is not the official production path.

## Official Path

Run production in this order:

1. Confirm input state and create the run id:
   - `input/voice.mp3` exists.
   - `output/elevenlabs_timestamps.json` exists.
   - `script.json` or `input/script.json` exists, or the timestamps file contains usable script text.
   - `tools/ffmpeg/bin/ffmpeg.exe` and `tools/ffmpeg/bin/ffprobe.exe` exist.
   - Choose the `run_id` before generating the timeline.
   - Snapshot the source voice metadata for this run: source path, duration, file size, mtime, and sha256.
   - If this run is later saved as a successful run, copy the source voice to `runs/<run_id>/input/voice.mp3` and record the archived copy hash in the run manifest.
2. Merge timestamps through the app route:
   - Start the local server if needed.
   - POST `/api/script/merge-timestamps`.
   - Confirm `output/timeline.json` and `output/script_timed.json` were written.
3. Generate caption cues:
   - Run `node scripts/generate_caption_cues.js`.
   - Confirm `output/timeline_with_captions.json` exists.
4. Validate `output/timeline_with_captions.json`:
   - `segments` exists and is non-empty.
   - Segment times are continuous.
   - Final `segment.end` matches the snapped source voice duration within `0.1` seconds.
   - `caption_cues` exists and final `caption_cue.end` matches the snapped source voice duration within `0.1` seconds.
   - If either timing check fails, rendering may continue for investigation, but the run must not be saved as a successful run.
5. Convert asset manifest:
   - Run `node scripts/adapt_asset_manifest.js`.
   - Confirm `output/asset_manifest_for_renderer.json` and `output/asset_manifest_check.json` exist.
6. Place assets by `segments`:
   - Use `output/timeline_with_captions.json` `segments` as the only video time base.
   - Do not use any fixed 30-second template duration or slot duration as time base.
7. Generate selected clips:
   - Run `node scripts/build_timeline_roughcut.js`.
   - Confirm `output/selected_clips/` contains one rendered clip per segment.
8. Generate `rough_cut.mp4`:
   - Confirm `output/rough_cut.mp4` exists.
   - Confirm `output/rough_cut_plan.json` exists.
9. Run minimum output verification:
   - Apply the `picoedit-render-verification` skill before calling the run successful.
   - Capture the successful run with `picoedit-success-capture`.
   - Only mark the run successful when the snapped voice, `timeline_with_captions.json`, `selected_clips`, `rough_cut_plan.json`, and `rough_cut.mp4` are from the same generation.

## Time Base Rule

The official video time axis is always:

```text
output/timeline_with_captions.json segments
```

For a successful run, the voice snapshot, final segment end, final caption cue end, and final rendered video duration must all agree within `0.1` seconds.

## Forbidden

- Do not use the old template route.
- Do not use `templates/*.json`.
- Do not use `slot.target_duration`.
- Do not manually adjust timing inside `timeline_with_captions.json`.
- Do not prioritize video duration over the audio/timestamp timeline.
- Do not make browser UI operation the official production procedure.
- Do not change ElevenLabs, timestamp generation, caption cue generation, FFmpeg settings, asset selection, or server API design while using this skill.
- Do not save a run as `pass` if `input/voice.mp3` has been overwritten after the timeline or render was created.

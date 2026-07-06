# PicoEdit

PicoEdit is a local rough-cut generator for vertical short videos. It creates an audio-timed, captioned rough cut from a script, using ElevenLabs audio and the generated timeline as the source of truth.

The official video time axis is always:

```text
output/timeline_with_captions.json segments
```

## What It Does

- Generates voice audio and timestamps with ElevenLabs
- Merges timestamps into `output/timeline.json`
- Generates caption cues in `output/timeline_with_captions.json`
- Converts the asset manifest for rendering
- Generates per-segment clips in `output/selected_clips/`
- Generates `output/rough_cut.mp4`
- Verifies that audio, final segment, final caption, and final render durations match

## Requirements

- Node.js 20 or newer
- ElevenLabs API key and Voice ID
- FFmpeg and ffprobe in `tools/ffmpeg/bin/`
- PicoEdit asset pack files, including `assets/asset_manifest.json`

## Quick Start

```powershell
npm install
```

Create `.env`:

```text
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
ELEVENLABS_MODEL_ID=eleven_v3
```

Start the local app:

```powershell
npm start
```

Open:

```text
http://127.0.0.1:8765/
```

Do not open `web/index.html` directly with `file://`; the app needs the local server for API and media routes.

## Current Workflow

```text
script
→ ElevenLabs voice generation
→ timestamp merge
→ caption cue generation
→ asset manifest conversion
→ rough_cut.mp4 generation
→ verification
```

A render is successful only when `verification.status` is `"pass"`. The existence of `output/rough_cut.mp4` alone is not enough.

## Main Outputs

- `output/timeline_with_captions.json`
- `output/selected_clips/`
- `output/rough_cut.mp4`
- `output/rough_cut_plan.json`

## More Documentation

- Japanese quickstart: [docs/QUICKSTART_JA.md](docs/QUICKSTART_JA.md)
- Japanese workflow guide: [docs/WORKFLOW_JA.md](docs/WORKFLOW_JA.md)
- Japanese troubleshooting: [docs/TROUBLESHOOTING_JA.md](docs/TROUBLESHOOTING_JA.md)

## Current Limits

- PicoEdit v1.0.0 produces a rough cut, not a fully polished final edit.
- Asset choice and visual beat quality may still need manual or Codex-assisted review.
- Missing assets should be fixed by adding suitable footage, not by treating stale outputs as success.

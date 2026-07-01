# picoedit

Local rough-cut web app for vertical short videos.

## Start

```powershell
npm start
```

Open:

```text
http://127.0.0.1:8765/
```

Do not open `web/index.html` directly with `file://`; the app needs the local
server for `/api/*` and video preview routes.

## What It Does

- Reads templates from `templates/*.json`.
- Lists video assets from `assets/`.
- Builds `output/rough_cut.mp4` with the bundled FFmpeg in `tools/ffmpeg/bin/`.
- Writes `output/timeline.json` and `output/edit_list.csv`.

If `input/voice.wav` exists, it is attached to the rendered video.

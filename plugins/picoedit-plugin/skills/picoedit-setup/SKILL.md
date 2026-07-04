---
name: picoedit-setup
description: Prepare or inspect a local Windows PicoEdit installation for a beginner. Use when the user asks to install PicoEdit, check Python/Node.js/FFmpeg, configure the R2 asset catalog URL, or verify the app can start. In v1, prioritize reading and preserving the fixed asset_catalog_url setting; do not implement full automatic installation unless explicitly requested in a later phase.
---

# PicoEdit Setup

## v1 Boundary

Use this skill to check and explain PicoEdit setup state. v1 must not broaden into full installer behavior.

Fixed v1 catalog URL:

```text
https://pub-78d5d49156194b43ae62cc67bd6faf88.r2.dev/asset_catalog.json
```

## Checks

- Confirm the PicoEdit project exists before changing anything.
- Confirm `config\settings.json` contains the fixed `asset_catalog_url`.
- Confirm Node.js and npm only when the user asks to start PicoEdit.
- Confirm FFmpeg only when the user asks to render or export.
- Keep responses in Japanese and hide command details from beginners unless a failure requires them.

## Safety

- Do not delete or overwrite user videos, assets, templates, or outputs.
- Do not change the catalog URL to arbitrary URLs.
- Do not deploy PicoEdit as a static website.
- If admin rights or login are needed, ask the user for only that action and then continue.

## Success Response

```text
PicoEditの設定を確認しました。
素材カタログURLは設定済みです。
次は、素材カタログを確認してください。
```

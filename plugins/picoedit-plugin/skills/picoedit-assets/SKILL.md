---
name: picoedit-assets
description: Read the PicoEdit Cloudflare R2 asset catalog and report available asset packs for a beginner. Use when the user asks to check PicoEdit素材, asset_catalog.json, R2 catalog, available asset packs, or whether PicoEdit can see downloadable packs. In v1, only fetch and display the catalog; do not download ZIPs, extract assets, update asset_manifest.json, or configure Google Drive/Dropbox.
---

# PicoEdit Assets

## Purpose

Use this skill to verify that PicoEdit can read the R2 asset catalog. Keep the beginner-facing response short and in Japanese.

Fixed v1 catalog URL:

```text
https://pub-78d5d49156194b43ae62cc67bd6faf88.r2.dev/asset_catalog.json
```

## Workflow

1. Use the bundled script from the PicoEdit repo:

```powershell
node C:\Users\kukyo\Documents\picoedit\plugins\picoedit-plugin\scripts\fetch_asset_catalog.mjs
```

2. If the local PicoEdit server is running, optionally verify the app endpoint:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/asset-catalog
```

3. Treat `packs: []` as success. Tell the user:

```text
利用可能な素材パックはありません。
```

4. If packs exist, list only the pack name/id/version. Do not download or extract in v1.

## Safety

- Do not fetch arbitrary catalog URLs. v1 allows only the fixed R2 URL.
- Do not download ZIP files yet.
- Do not create or update `asset_manifest.json` yet.
- Do not modify `assets\` in v1.
- Do not handle Google Drive or Dropbox synchronization.

## Response Style

Success with no packs:

```text
素材カタログを確認しました。
利用可能な素材パックはありません。
次は、素材パックが追加された後にもう一度確認してください。
```

Error:

```text
素材カタログを確認できませんでした。
原因: <短い原因>
次の一手: ネット接続と配布URLを確認してください。
```

# PicoEdit

## これは何か

PicoEditは、縦型ショート動画向けのローカル・ラフカット生成ツールです。台本からElevenLabsで音声を作り、その音声タイムラインを基準に、字幕付きの `rough_cut.mp4` を生成します。

正式な動画時間軸は常に `output/timeline_with_captions.json` の `segments` です。

## できること

- 台本からElevenLabs音声とtimestampsを生成する
- timestampsを `output/timeline.json` に結合する
- 字幕cueを生成して `output/timeline_with_captions.json` を作る
- 素材manifestを変換し、segmentsごとに素材を配置する
- `output/selected_clips/` と `output/rough_cut.mp4` を生成する
- verificationで、音声・segment・字幕・完成動画の尺が一致しているか確認する

## 向いている人

- 縦型ショート動画の下書きを素早く作りたい人
- 音声と字幕のタイミングを基準に動画を組みたい人
- Codexなどと一緒に、生成・確認・改善を繰り返したい人

## 現時点で必要なもの

- Node.js 20以上
- ElevenLabs APIキー
- ElevenLabs Voice ID
- FFmpeg / ffprobe
  - `tools/ffmpeg/bin/ffmpeg.exe`
  - `tools/ffmpeg/bin/ffprobe.exe`
- PicoEdit用の素材パック
  - `assets/asset_manifest.json`
  - `assets/core_ai_education/` などの動画素材

## 最短セットアップ

```powershell
npm install
```

`.env` を作成し、以下を設定します。

```text
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
ELEVENLABS_MODEL_ID=eleven_v3
```

起動します。

```powershell
npm start
```

ブラウザで開きます。

```text
http://127.0.0.1:8765/
```

`web/index.html` を `file://` で直接開かないでください。PicoEditはローカルサーバーの `/api/*` と `/media/*` を使います。

## 1本作る流れ

```text
台本
→ ElevenLabs音声生成
→ timestamps結合
→ caption cues生成
→ 素材manifest変換
→ rough_cut.mp4生成
→ verification
```

UIでは、台本を入力して音声を生成し、`timestamps結合` を押したあと、`音声タイムライン生成` を押します。成功扱いになるのは `verification.status: "pass"` の時だけです。

## 出力されるもの

- `output/timeline_with_captions.json`
  - segmentsと字幕cueを含む正式なタイムライン
- `output/selected_clips/`
  - segmentごとに切り出された動画
- `output/rough_cut.mp4`
  - 字幕と音声を含むラフカット動画
- `output/rough_cut_plan.json`
  - どのsegmentにどの素材を使ったかを記録した計画ファイル

## 詳しい使い方

- [最初の1本を作る手順](docs/QUICKSTART_JA.md)
- [制作フローとファイルの役割](docs/WORKFLOW_JA.md)
- [よくある失敗と対処](docs/TROUBLESHOOTING_JA.md)
- [English README](README_EN.md)

## 現時点の制約

- 自動生成された動画はラフカットです。最終品質には素材追加や見直しが必要です。
- `rough_cut.mp4` が存在するだけでは成功ではありません。必ずverificationを確認してください。
- 素材が足りない役割では、同じ素材のloopが長くなる場合があります。
- 旧テンプレート経路はv1.0.0の主要導線ではありません。
- 素材選定やvisual beat設計の改善は、今後の別テーマです。

## 開発者向け情報

- v1.0.0の基準は、音声タイムライン方式です。
- 正式な動画時間軸は `output/timeline_with_captions.json` の `segments` です。
- 成功条件は `verification.status: "pass"` です。
- `input/voice.mp3`、最終segment、最終caption、`rough_cut.mp4` の尺が0.1秒以内で一致する必要があります。
- レンダー処理、素材選定、FFmpeg設定、ElevenLabs連携はそれぞれ分けて扱ってください。

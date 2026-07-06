# PicoEdit 制作フロー

PicoEdit v1.0.0の正式経路は、音声タイムラインを基準にしたラフカット生成です。

```text
台本
→ 音声生成
→ timestamps
→ timeline.json
→ timeline_with_captions.json
→ 素材manifest
→ selected_clips
→ rough_cut.mp4
→ verification
```

## 台本

動画で話す内容です。UIの文章入力欄に入れて音声生成します。

## 音声生成

ElevenLabsで `input/voice.mp3` を生成します。同時に、文字ごとのタイミング情報も作られます。

## timestamps

`output/elevenlabs_timestamps.json` に保存される、音声と文字の対応情報です。字幕やsegmentsの時間を作るために使います。

## timeline.json

timestamps結合後に作られる中間タイムラインです。台本の各segmentに開始時刻と終了時刻が入ります。

## timeline_with_captions.json

字幕cueを追加した正式タイムラインです。`segments` がPicoEditの正式な動画時間軸です。

このファイルの `segments` 以外を、完成動画の時間基準として扱わないでください。

## 素材manifest

`assets/asset_manifest.json` をレンダー用に変換したものです。`output/asset_manifest_for_renderer.json` と `output/asset_manifest_check.json` が作られます。

`asset_manifest_check.json` の `missing_count` が0であることが重要です。

## selected_clips

`output/selected_clips/` に、segmentごとの動画が作られます。動画数は `segments.length` と一致する必要があります。

## rough_cut.mp4

字幕と音声を含むラフカット動画です。ただし、`rough_cut.mp4` が存在するだけでは成功ではありません。

## verification

成功確認です。`verification.status: "pass"` を確認して初めて成功です。

成功条件は次の通りです。

- `input/voice.mp3` の尺
- 最終 `segment.end`
- 最終 `caption_cue.end`
- `output/rough_cut.mp4` の尺

これらがすべて0.1秒以内で一致する必要があります。

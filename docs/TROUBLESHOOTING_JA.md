# PicoEdit トラブルシューティング

よくある失敗と確認先です。PicoEditでは、動画が存在していてもverificationがpassでなければ成功扱いにしません。

## `npm start` が起動しない

症状  
コマンドを実行してもサーバーが起動しない。

原因候補  
Node.jsが古い、依存関係が入っていない、別プロセスがポートを使っている。

確認するファイルまたは設定  
`package.json`、Node.jsのバージョン、ターミナルのエラー。

対処  
Node.js 20以上を使い、`npm install` を実行してください。すでに起動中のPicoEditがあれば停止してください。

## `http://127.0.0.1:8765/` が開けない

症状  
ブラウザでPicoEditの画面が開けない。

原因候補  
`npm start` が起動していない、別ポートで起動している、セキュリティソフトがローカル接続を止めている。

確認するファイルまたは設定  
ターミナルの起動ログ、`http://127.0.0.1:8765/api/health`。

対処  
`npm start` を起動し直し、`/api/health` が `ok: true` を返すか確認してください。

## ElevenLabs APIキー未設定

症状  
音声生成ができず、APIキー未設定と表示される。

原因候補  
`.env` に `ELEVENLABS_API_KEY` がない、または空になっている。

確認するファイルまたは設定  
`.env`

対処  
`ELEVENLABS_API_KEY=...` を設定して、アプリを再起動してください。

## Voice ID未設定

症状  
音声生成ができず、Voice ID未設定と表示される。

原因候補  
`.env` に `ELEVENLABS_VOICE_ID` がない、または間違っている。

確認するファイルまたは設定  
`.env`、ElevenLabsのVoice ID。

対処  
正しいVoice IDを `ELEVENLABS_VOICE_ID=...` に設定し、アプリを再起動してください。

## FFmpeg / ffprobe が見つからない

症状  
動画生成または尺確認で失敗する。

原因候補  
FFmpegとffprobeが配置されていない。

確認するファイルまたは設定  
`tools/ffmpeg/bin/ffmpeg.exe`、`tools/ffmpeg/bin/ffprobe.exe`

対処  
FFmpegとffprobeを `tools/ffmpeg/bin/` に配置してください。

## `先にtimestamps結合を実行してください`

症状  
`音声タイムライン生成` を押すと、このエラーで止まる。

原因候補  
`output/timeline.json` がまだ作られていない。

確認するファイルまたは設定  
`output/timeline.json`、`output/elevenlabs_timestamps.json`

対処  
先に `音声生成` を実行し、その後 `timestamps結合` を押してください。

## 素材が足りない / manifestエラー

症状  
素材manifest変換やラフカット生成で失敗する。

原因候補  
素材ファイルが足りない、`assets/asset_manifest.json` と実ファイルの場所が一致していない。

確認するファイルまたは設定  
`assets/asset_manifest.json`、`assets/core_ai_education/`、`output/asset_manifest_check.json`

対処  
不足している素材を配置し直してください。`missing_count` が0になる必要があります。

## `verification.status: needs_revalidation`

症状  
動画はあるのに成功扱いにならない。

原因候補  
音声、segments、字幕、完成動画の尺が一致していない。古い出力が残っている。今回の実行で成果物が更新されていない。

確認するファイルまたは設定  
`output/timeline_with_captions.json`、`output/rough_cut_plan.json`、`output/rough_cut.mp4`、`output/selected_clips/`

対処  
`failed_checks` に出ている項目を確認してください。音声を作り直した場合は、timestamps結合からやり直してください。

## 動画が存在しているのに成功扱いにならない

症状  
`output/rough_cut.mp4` はあるが、UIではOKにならない。

原因候補  
古い動画だけが残っている、`rough_cut_plan.json` が古い、verificationが失敗している。

確認するファイルまたは設定  
`verification.failed_checks`、`output/rough_cut_plan.json`、`output/timeline_with_captions.json`

対処  
`音声タイムライン生成` をもう一度実行し、verificationがpassになるか確認してください。

## `selected_clips` 数とsegments数が一致しない

症状  
verificationで `selected_clips_count` が失敗する。

原因候補  
segment数と生成された分割動画数が合っていない。途中でレンダーが失敗した可能性があります。

確認するファイルまたは設定  
`output/timeline_with_captions.json`、`output/selected_clips/`、`output/rough_cut_plan.json`

対処  
`output/timeline_with_captions.json` のsegments数と `output/selected_clips/` の動画数を確認し、`音声タイムライン生成` を再実行してください。

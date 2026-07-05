# PicoEdit クイックスタート

最初の1本を作るための手順です。PicoEditは、音声のタイミングを基準に縦型ショート動画のラフカットを作ります。

## 1. 必要環境

Node.js 20以上、ElevenLabs APIキー、ElevenLabs Voice ID、FFmpeg / ffprobe、PicoEdit用の動画素材が必要です。

失敗したら、まず `npm install` が済んでいるか、`.env` と `tools/ffmpeg/bin/` があるかを確認してください。

## 2. リポジトリ取得

GitHubからPicoEditを取得します。

```powershell
git clone <repository-url>
cd picoedit
```

成功すると、`server.js`、`web/`、`scripts/` などが見える状態になります。

## 3. npm install

Node.jsの依存関係を入れます。

```powershell
npm install
```

失敗したら、Node.jsのバージョンが20以上か確認してください。

## 4. FFmpeg配置

FFmpegとffprobeを以下に配置します。

```text
tools/ffmpeg/bin/ffmpeg.exe
tools/ffmpeg/bin/ffprobe.exe
```

成功すると、PicoEditが動画の生成と尺確認を実行できます。見つからない場合は、`FFmpeg / ffprobe が見つからない` というエラーになります。

## 5. .env設定

プロジェクト直下に `.env` を作ります。

```text
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
ELEVENLABS_MODEL_ID=eleven_v3
```

APIキーやVoice IDが空だと、UIに未設定として表示されます。

## 6. 素材の準備

素材manifestと動画素材を配置します。

```text
assets/asset_manifest.json
assets/core_ai_education/
```

成功すると、UIの素材欄に素材数が表示されます。manifestエラーが出る場合は、`assets/asset_manifest.json` と素材ファイルの場所を確認してください。

## 7. アプリ起動

```powershell
npm start
```

ブラウザで開きます。

```text
http://127.0.0.1:8765/
```

`web/index.html` を直接開かないでください。APIと動画プレビューが動きません。

## 8. 音声生成

UIの文章入力欄に台本を入れて、`音声生成` を押します。

成功すると、`input/voice.mp3` と `output/elevenlabs_timestamps.json` が作られます。失敗したら `.env` のAPIキー、Voice ID、ネット接続を確認してください。

## 9. timestamps結合

`timestamps結合` を押します。

成功すると、`output/timeline.json` と `output/script_timed.json` が作られます。失敗したら、音声生成が完了しているか、timestampsが存在するかを確認してください。

## 10. 音声タイムライン生成

`音声タイムライン生成` を押します。

内部では次の順に実行されます。

```text
caption cues生成
→ 素材manifest変換
→ ラフカット生成
→ verification
```

成功すると `output/selected_clips/` と `output/rough_cut.mp4` が作られます。

## 11. verification確認

UIのタイムライン欄で `OK` または `verification.status: "pass"` に相当する状態を確認します。

成功条件は、音声、最終segment、最終caption、完成動画の尺が0.1秒以内で一致することです。`needs_revalidation` の場合は、古い出力や素材不足の可能性があります。

## 12. 動画確認・書き出し

プレビューで `rough_cut.mp4` を確認します。必要であれば、分割素材や1本動画を書き出します。

動画が存在していても、verificationがpassでなければ成功扱いにしないでください。

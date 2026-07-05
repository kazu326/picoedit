const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "output");
const timelinePath = path.join(outputDir, "timeline_with_captions.json");
const assPath = path.join(outputDir, "caption_preview.ass");
const previewPath = path.join(outputDir, "caption_preview.mp4");
const audioPath = path.join(rootDir, "input", "voice.mp3");
const ffmpegPath = path.join(rootDir, "tools", "ffmpeg", "bin", "ffmpeg.exe");
const ffprobePath = path.join(rootDir, "tools", "ffmpeg", "bin", "ffprobe.exe");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`JSONを読み込めません: ${filePath}\n${error.message}`);
  }
}

function secondsToAssTime(value) {
  const totalCentiseconds = Math.round(Number(value) * 100);
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

function makeAss(cues) {
  const events = cues.map((cue) => {
    const lines = Array.isArray(cue.lines) && cue.lines.length > 0 ? cue.lines.slice(0, 2) : [cue.text || ""];
    const text = lines.map(escapeAssText).join("\\N");
    return `Dialogue: 0,${secondsToAssTime(cue.start)},${secondsToAssTime(cue.end)},Caption,,0,0,0,,${text}`;
  });

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Yu Gothic UI,68,&H00FFFFFF,&H000000FF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,5,1,2,90,90,250,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\r\n");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(`${path.basename(command)} の実行に失敗しました。\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

if (!fs.existsSync(timelinePath)) fail("output/timeline_with_captions.json が見つかりません。");
if (!fs.existsSync(audioPath)) fail("input/voice.mp3 が見つかりません。");
if (!fs.existsSync(ffmpegPath)) fail("FFmpeg が見つかりません。");
if (!fs.existsSync(ffprobePath)) fail("ffprobe が見つかりません。");

const timeline = readJson(timelinePath);
const cues = Array.isArray(timeline.caption_cues) ? timeline.caption_cues : [];
if (cues.length === 0) fail("caption_cues が空です。");

const duration = Number(timeline.audio && timeline.audio.duration_sec ? timeline.audio.duration_sec : cues[cues.length - 1].end);
if (!Number.isFinite(duration) || duration <= 0) fail("音声尺を確認できません。");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(assPath, makeAss(cues), "utf8");

run(
  ffmpegPath,
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x141817:s=1080x1920:r=30:d=${duration.toFixed(3)}`,
    "-i",
    path.relative(outputDir, audioPath),
    "-vf",
    "subtitles=caption_preview.ass",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-r",
    "30",
    "-t",
    duration.toFixed(3),
    "-shortest",
    path.basename(previewPath),
  ],
  { cwd: outputDir }
);

const audioDuration = Number(run(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath]));
const videoDuration = Number(run(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", previewPath]));
const streamJson = JSON.parse(run(ffprobePath, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate", "-of", "json", previewPath]));
const stream = streamJson.streams && streamJson.streams[0] ? streamJson.streams[0] : {};
const diff = Math.abs(videoDuration - audioDuration);
if (diff > 0.1) {
  fail(`動画尺と音声尺の差が0.1秒を超えました。audio=${audioDuration}, video=${videoDuration}, diff=${diff}`);
}

console.log(
  JSON.stringify(
    {
      preview: previewPath,
      subtitles: assPath,
      cue_count: cues.length,
      audio_duration: audioDuration,
      video_duration: videoDuration,
      duration_diff: diff,
      width: stream.width,
      height: stream.height,
      fps: stream.avg_frame_rate,
    },
    null,
    2
  )
);

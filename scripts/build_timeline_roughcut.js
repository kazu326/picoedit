const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "output");
const timelinePath = path.join(outputDir, "timeline_with_captions.json");
const manifestPath = path.resolve(rootDir, process.env.ASSET_MANIFEST_PATH || "output/asset_manifest_for_renderer.json");
const audioPath = path.join(rootDir, "input", "voice.mp3");
const planPath = path.join(outputDir, "rough_cut_plan.json");
const roughCutPath = path.join(outputDir, "rough_cut.mp4");
const captionsPath = path.join(outputDir, "rough_cut_captions.ass");
const selectedClipsDir = path.join(outputDir, "selected_clips");
const ffmpegPath = path.join(rootDir, "tools", "ffmpeg", "bin", "ffmpeg.exe");
const ffprobePath = path.join(rootDir, "tools", "ffmpeg", "bin", "ffprobe.exe");
const rolePlan = ["hook", "problem", "explain", "explain", "proof", "explain", "cta"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${filePath} を読み込めません: ${error.message}`);
  }
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

function rel(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function round(value) {
  return Number(Number(value).toFixed(6));
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

function writeCaptionAss(cues) {
  if (!Array.isArray(cues) || cues.length === 0) {
    return null;
  }
  const events = cues.map((cue) => {
    const lines = Array.isArray(cue.lines) && cue.lines.length > 0 ? cue.lines.slice(0, 2) : [cue.text || ""];
    const text = lines.map(escapeAssText).join("\\N");
    return `Dialogue: 0,${secondsToAssTime(cue.start)},${secondsToAssTime(cue.end)},Caption,,0,0,0,,${text}`;
  });
  const ass = [
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
  fs.writeFileSync(captionsPath, ass, "utf8");
  return captionsPath;
}

function pickAsset(videos, role, used, targetDuration) {
  const candidates = videos
    .filter((video) => video.role === role && video.exists && !used.has(video.path))
    .sort((a, b) => {
      const aCovers = Number(a.duration) >= targetDuration ? 0 : 1;
      const bCovers = Number(b.duration) >= targetDuration ? 0 : 1;
      if (aCovers !== bCovers) return aCovers - bCovers;
      return Math.abs(Number(a.duration) - targetDuration) - Math.abs(Number(b.duration) - targetDuration);
    });
  if (!candidates.length) {
    fail(`${role} 用の未使用素材が見つかりません。`);
  }
  const selected = candidates[0];
  used.add(selected.path);
  return selected;
}

function probeDuration(filePath) {
  return Number(run(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath]));
}

function renderSegment(segment, asset, index) {
  const duration = round(Number(segment.end) - Number(segment.start));
  const clipName = `roughcut_segment_${String(index + 1).padStart(2, "0")}.mp4`;
  const clipPath = path.join(outputDir, clipName);
  const needsLoop = Number(asset.duration) < duration;
  const args = [
    "-y",
    ...(needsLoop ? ["-stream_loop", "-1"] : []),
    "-i",
    asset.absolute_path,
    "-t",
    duration.toFixed(6),
    "-an",
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    clipPath,
  ];
  run(ffmpegPath, args);
  return { clipPath, duration, mode: needsLoop ? "loop" : "trim" };
}

function safeClipName(segment, index) {
  const id = String(segment.id || segment.segment_id || segment.slot_id || `segment_${index + 1}`)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || `segment_${index + 1}`;
  return `${String(index + 1).padStart(2, "0")}_${id}.mp4`;
}

if (!fs.existsSync(timelinePath)) fail("output/timeline_with_captions.json が見つかりません。");
if (!fs.existsSync(manifestPath)) fail(`${rel(manifestPath)} が見つかりません。`);
if (!fs.existsSync(audioPath)) fail("input/voice.mp3 が見つかりません。");
if (!fs.existsSync(ffmpegPath)) fail("FFmpeg が見つかりません。");
if (!fs.existsSync(ffprobePath)) fail("ffprobe が見つかりません。");

const timeline = readJson(timelinePath);
const manifest = readJson(manifestPath);
const segments = Array.isArray(timeline.segments) ? timeline.segments : [];
const captionCues = Array.isArray(timeline.caption_cues) ? timeline.caption_cues : [];
const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
if (segments.length !== 7) fail(`segmentsが7件ではありません: ${segments.length}`);
if (videos.length !== 34) fail(`認識素材が34本ではありません: ${videos.length}`);

fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(selectedClipsDir, { recursive: true, force: true });
fs.mkdirSync(selectedClipsDir, { recursive: true });

const expectedDuration = round(segments[segments.length - 1].end);
const currentAudioDuration = probeDuration(audioPath);
const sourceDurationDiff = Math.abs(currentAudioDuration - expectedDuration);
if (sourceDurationDiff > 0.1) {
  fail(
    [
      "input/voice.mp3 と output/timeline_with_captions.json の尺が一致しません。",
      `音声: ${currentAudioDuration.toFixed(3)}s / タイムライン: ${expectedDuration.toFixed(3)}s / 差分: ${sourceDurationDiff.toFixed(3)}s`,
      "音声を作り直した場合は、timestamps結合とcaption_cues生成をやり直してください。",
    ].join("\n")
  );
}

const used = new Set();
const segmentPlans = [];
const concatList = [];
for (let index = 0; index < segments.length; index += 1) {
  const segment = segments[index];
  const role = segment.role || segment.video_slot?.role || rolePlan[index];
  const duration = round(Number(segment.end) - Number(segment.start));
  const asset = pickAsset(videos, role, used, duration);
  const rendered = renderSegment(segment, asset, index);
  const selectedClipPath = path.join(selectedClipsDir, safeClipName(segment, index));
  fs.copyFileSync(rendered.clipPath, selectedClipPath);
  segmentPlans.push({
    segment_id: segment.id || segment.segment_id || `segment_${String(index + 1).padStart(2, "0")}`,
    role,
    start: round(segment.start),
    end: round(segment.end),
    duration_sec: duration,
    asset_path: asset.path,
    source_duration: round(asset.duration),
    render_mode: rendered.mode,
    clip: rel(rendered.clipPath),
    selected_clip: rel(selectedClipPath),
  });
  concatList.push(`file '${rendered.clipPath.replace(/'/g, "'\\''")}'`);
}

const concatPath = path.join(outputDir, "roughcut_concat.txt");
fs.writeFileSync(concatPath, concatList.join("\n") + "\n", "utf8");
const captionFile = writeCaptionAss(captionCues);

const finalArgs = [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatPath,
  "-i",
  audioPath,
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
];
if (captionFile) {
  finalArgs.push(
    "-vf",
    "subtitles=output/rough_cut_captions.ass",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p"
  );
} else {
  finalArgs.push("-c:v", "copy");
}
finalArgs.push(
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-t",
  expectedDuration.toFixed(6),
  "-shortest",
  roughCutPath
);
run(ffmpegPath, finalArgs);

const audioDuration = currentAudioDuration;
const roughCutDuration = probeDuration(roughCutPath);
const durationDiff = Math.abs(roughCutDuration - audioDuration);
const streamJson = JSON.parse(run(ffprobePath, [
  "-v",
  "error",
  "-select_streams",
  "v:0",
  "-show_entries",
  "stream=width,height,avg_frame_rate",
  "-of",
  "json",
  roughCutPath,
]));
const stream = streamJson.streams?.[0] || {};

const plan = {
  ok: durationDiff <= 0.1,
  source_timeline: "output/timeline_with_captions.json",
  source_manifest: rel(manifestPath),
  output: "output/rough_cut.mp4",
  recognized_video_count: videos.length,
  segment_count: segments.length,
  expected_duration: expectedDuration,
  audio_duration: round(audioDuration),
  rough_cut_duration: round(roughCutDuration),
  duration_diff: round(durationDiff),
  width: stream.width,
  height: stream.height,
  fps: stream.avg_frame_rate,
  caption_cue_count: captionCues.length,
  captions: captionFile ? rel(captionFile) : null,
  assignments: segmentPlans,
};

fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

console.log(`manifest: ${rel(manifestPath)}`);
console.log(`recognized videos: ${videos.length}`);
console.log(`segments assigned: ${segments.length}`);
for (const item of segmentPlans) {
  console.log(`${item.segment_id}: ${item.role} -> ${item.asset_path} (${item.start}-${item.end}s, ${item.render_mode})`);
}
console.log(`created: ${rel(planPath)}`);
if (captionFile) {
  console.log(`captions: ${rel(captionFile)} (${captionCues.length} cues)`);
}
console.log(`created: ${rel(roughCutPath)}`);
console.log(`audio duration: ${audioDuration.toFixed(3)}s`);
console.log(`rough_cut duration: ${roughCutDuration.toFixed(3)}s`);
console.log(`duration diff: ${durationDiff.toFixed(3)}s`);
if (!plan.ok) {
  fail("rough cut duration check failed");
}

#!/usr/bin/env node
"use strict";

/**
 * PicoEdit timeline-driven rough-cut renderer.
 *
 * Inputs (existing pipeline; never overwritten):
 *   - output/timeline_with_captions.json
 *   - input/voice.mp3
 *   - asset_manifest.json (auto-discovered under project root/assets/output/config)
 *
 * Outputs:
 *   - output/rough_cut.mp4
 *   - output/rough_cut_plan.json
 *   - output/rough_cut_subtitles.ass
 *   - output/asset_manifest_check.json
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.join(ROOT, "input");
const OUTPUT_DIR = path.join(ROOT, "output");
const ASSET_DIR = path.join(ROOT, "assets");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv"]);
const FPS = numberEnv("ROUGH_CUT_FPS", 30);
const [WIDTH, HEIGHT] = parseOutputSize(process.env.ROUGH_CUT_SIZE || "1080x1920");
const SHORT_ASSET_SLOWDOWN_THRESHOLD = 0.85;

function numberEnv(name, fallback) {
  const value = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseOutputSize(value) {
  const [widthText, heightText] = String(value).toLowerCase().split("x");
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`ROUGH_CUT_SIZE must be like 1080x1920. Received: ${value}`);
  }
  return [width, height];
}

function ffmpegPath(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const bundled = path.join(ROOT, "tools", "ffmpeg", "bin", exe);
  return fs.existsSync(bundled) ? bundled : exe;
}

function projectPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function assertInsideRoot(filePath, root = ROOT) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path is outside the permitted root: ${filePath}`);
  }
  return resolved;
}

function resolveProjectFile(value, label) {
  if (!value) {
    throw new Error(`${label} path is empty.`);
  }
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value);
  return assertInsideRoot(resolved);
}

function isVideo(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function runCommand(command, args, context) {
  try {
    return await execFileAsync(command, args, {
      cwd: ROOT,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 80,
    });
  } catch (error) {
    const output = `${error.stderr || ""}${error.stdout || ""}`.trim();
    throw new Error(`${context} failed:\n${output || error.message}`);
  }
}

async function probeDuration(filePath) {
  const ffprobe = ffmpegPath("ffprobe");
  const result = await runCommand(
    ffprobe,
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    `ffprobe for ${projectPath(filePath)}`
  );
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not read a positive duration: ${projectPath(filePath)}`);
  }
  return duration;
}

function firstExisting(candidates, label) {
  for (const candidate of candidates.filter(Boolean)) {
    const resolved = resolveProjectFile(candidate, label);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(`${label} was not found. Checked:\n${candidates.filter(Boolean).join("\n")}`);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${projectPath(filePath)}\n${error.message}`);
  }
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function splitRoleTokens(value) {
  return toArray(value)
    .flatMap((item) => String(item).split(/[\\/|,\s]+/))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function canonicalRole(value) {
  const token = String(value || "").trim().toLowerCase();
  const aliases = {
    hook: "hook",
    intro: "hook",
    opening: "hook",
    problem: "problem",
    pain: "problem",
    issue: "problem",
    explain: "explain",
    explanation: "explain",
    body: "explain",
    education: "explain",
    proof: "proof",
    example: "proof",
    result: "proof",
    evidence: "proof",
    cta: "cta",
    closing: "cta",
    outro: "cta",
  };
  return aliases[token] || null;
}

function extractManifestRows(rawManifest) {
  if (Array.isArray(rawManifest)) return rawManifest;
  if (!rawManifest || typeof rawManifest !== "object") return [];

  for (const key of ["assets", "files", "items", "videos", "entries", "media"]) {
    if (Array.isArray(rawManifest[key])) return rawManifest[key];
  }

  // Accept object maps: { "assets/hook/a.mp4": { ...metadata } }
  const values = Object.entries(rawManifest)
    .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
    .map(([key, value]) => ({ path: value.path || key, ...value }));
  return values;
}

async function normalizeAssetManifest(rawManifest, manifestPath) {
  const rows = extractManifestRows(rawManifest);
  if (!rows.length) {
    throw new Error(
      `asset_manifest.json has no readable asset array. Supported top-level keys: assets, files, items, videos, entries, media.\n${projectPath(manifestPath)}`
    );
  }

  const assets = [];
  const skipped = [];
  for (const row of rows) {
    const rawPath = typeof row === "string"
      ? row
      : pickFirst(row.path, row.file_path, row.relative_path, row.asset_path, row.file, row.source, row.src);

    if (!rawPath) {
      skipped.push({ reason: "path field missing", row });
      continue;
    }

    let filePath;
    try {
      filePath = resolveProjectFile(String(rawPath), "Asset");
    } catch (error) {
      skipped.push({ reason: error.message, path: rawPath });
      continue;
    }

    if (!isVideo(filePath)) {
      skipped.push({ reason: "not a supported video extension", path: rawPath });
      continue;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      skipped.push({ reason: "file does not exist", path: rawPath });
      continue;
    }

    const folder = projectPath(path.dirname(filePath));
    const declaredTokens = [
      ...splitRoleTokens(row?.role),
      ...splitRoleTokens(row?.roles),
      ...splitRoleTokens(row?.category),
      ...splitRoleTokens(row?.categories),
      ...splitRoleTokens(row?.tags),
      ...splitRoleTokens(row?.folder),
      ...splitRoleTokens(folder),
    ];
    const roles = [...new Set(declaredTokens.map(canonicalRole).filter(Boolean))];

    assets.push({
      id: String(pickFirst(row?.id, row?.asset_id, projectPath(filePath))),
      filePath,
      projectPath: projectPath(filePath),
      folder,
      name: path.basename(filePath),
      roles,
      tags: declaredTokens,
      raw: typeof row === "object" ? row : { path: row },
    });
  }

  if (!assets.length) {
    throw new Error(
      `No valid videos were found from ${projectPath(manifestPath)}. Check that manifest paths are project-relative, e.g. assets/hook/clip.mp4.`
    );
  }
  return { assets, skipped };
}

function inferSegmentRole(segment, index, total) {
  const direct = [
    segment.role,
    segment.visual_role,
    segment.asset_role,
    segment.category,
    segment.type,
    segment.section,
    segment.folder,
  ];
  for (const value of direct) {
    for (const token of splitRoleTokens(value)) {
      const role = canonicalRole(token);
      if (role) return role;
    }
  }

  // Only a deterministic fallback. Semantic inference from the spoken text belongs in a later step.
  if (index === 0) return "hook";
  if (index === total - 1) return "cta";
  return "explain";
}

function normalizeTimeline(rawTimeline) {
  const rawSegments = Array.isArray(rawTimeline)
    ? rawTimeline
    : (rawTimeline?.segments || rawTimeline?.visual_segments || rawTimeline?.timeline || []);
  const rawCues = rawTimeline?.caption_cues || rawTimeline?.captions || rawTimeline?.cues || [];

  if (!Array.isArray(rawSegments) || !rawSegments.length) {
    throw new Error("timeline_with_captions.json must contain a non-empty segments array.");
  }
  if (!Array.isArray(rawCues)) {
    throw new Error("timeline_with_captions.json caption_cues must be an array.");
  }

  const segments = rawSegments.map((segment, index) => {
    const start = Number(pickFirst(segment.start, segment.start_sec, segment.from));
    const end = Number(pickFirst(segment.end, segment.end_sec, segment.to));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Segment #${index + 1} needs numeric start/end values with end > start.`);
    }
    return {
      ...segment,
      id: String(pickFirst(segment.id, segment.segment_id, segment.slot_id, `segment_${String(index + 1).padStart(2, "0")}`)),
      start,
      end,
      duration: end - start,
    };
  }).sort((a, b) => a.start - b.start);

  const tolerance = 0.08;
  if (segments[0].start > tolerance) {
    throw new Error(`First segment starts at ${segments[0].start.toFixed(3)}s, not 0s. Do not silently invent a visual gap.`);
  }
  for (let index = 1; index < segments.length; index += 1) {
    const gap = segments[index].start - segments[index - 1].end;
    if (Math.abs(gap) > tolerance) {
      throw new Error(
        `Segments #${index} and #${index + 1} are not contiguous (${segments[index - 1].end.toFixed(3)}s -> ${segments[index].start.toFixed(3)}s).`
      );
    }
  }

  const captionCues = rawCues.map((cue, index) => {
    const start = Number(pickFirst(cue.start, cue.start_sec, cue.from));
    const end = Number(pickFirst(cue.end, cue.end_sec, cue.to));
    const text = String(pickFirst(cue.text, cue.caption, cue.value, "")).trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) {
      throw new Error(`caption_cues #${index + 1} needs start/end/text.`);
    }
    return { ...cue, start, end, text };
  }).sort((a, b) => a.start - b.start);

  return { segments, captionCues };
}

function stableHash(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function assignAssets(segments, assets, warnings) {
  const durationCache = new Map();
  const used = new Set();

  async function durationOf(asset) {
    if (!durationCache.has(asset.filePath)) {
      durationCache.set(asset.filePath, probeDuration(asset.filePath));
    }
    return durationCache.get(asset.filePath);
  }

  const assignments = [];
  for (const [index, segment] of segments.entries()) {
    const role = inferSegmentRole(segment, index, segments.length);
    const roleMatches = assets.filter((asset) => asset.roles.includes(role));
    const pool = roleMatches.length ? roleMatches : assets;
    if (!roleMatches.length) {
      warnings.push(`Segment '${segment.id}' requested role '${role}', but no manifest asset matched it. Global fallback was used.`);
    }

    const candidates = [];
    for (const asset of pool) {
      const sourceDuration = await durationOf(asset);
      const ratio = sourceDuration / segment.duration;
      let fitScore = 0;
      if (ratio >= 1) fitScore = 30;
      else if (ratio >= SHORT_ASSET_SLOWDOWN_THRESHOLD) fitScore = 20;
      else if (ratio >= 0.5) fitScore = 10;
      const reusePenalty = used.has(asset.filePath) ? -100 : 0;
      candidates.push({
        asset,
        sourceDuration,
        score: fitScore + reusePenalty,
        tie: stableHash(`${segment.id}|${asset.projectPath}`),
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.tie - b.tie || a.asset.projectPath.localeCompare(b.asset.projectPath));
    const selected = candidates[0];
    used.add(selected.asset.filePath);

    assignments.push({
      ...segment,
      role,
      asset: selected.asset,
      sourceDuration: selected.sourceDuration,
    });
  }
  return assignments;
}

function framePlan(assignments, voiceDuration) {
  const finalFrame = Math.max(1, Math.round(voiceDuration * FPS));
  let priorFrame = 0;

  return assignments.map((assignment, index) => {
    const desiredEnd = index === assignments.length - 1 ? finalFrame : Math.round(assignment.end * FPS);
    const endFrame = Math.max(priorFrame + 1, Math.min(finalFrame, desiredEnd));
    const frameCount = endFrame - priorFrame;
    const targetDuration = frameCount / FPS;
    const timelineDuration = assignment.end - assignment.start;
    const sourceDuration = assignment.sourceDuration;

    let mode;
    let speed = 1;
    let sourceOffset = 0;
    if (sourceDuration >= targetDuration) {
      mode = "trim";
      const availableOffset = sourceDuration - targetDuration;
      if (availableOffset > 0.08) {
        sourceOffset = (stableHash(`${assignment.id}|${assignment.asset.projectPath}`) / 0xffffffff) * availableOffset;
      }
    } else if (sourceDuration / targetDuration >= SHORT_ASSET_SLOWDOWN_THRESHOLD) {
      mode = "slow_down";
      speed = sourceDuration / targetDuration;
    } else {
      mode = "loop";
    }

    priorFrame = endFrame;
    return {
      ...assignment,
      frameStart: endFrame - frameCount,
      frameEnd: endFrame,
      frameCount,
      targetDuration,
      timelineDuration,
      mode,
      speed,
      sourceOffset,
    };
  });
}

function videoFilter({ speed, duration }) {
  const setpts = speed === 1
    ? "setpts=PTS-STARTPTS"
    : `setpts=(PTS-STARTPTS)/${speed.toFixed(12)}`;
  return [
    setpts,
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${WIDTH}:${HEIGHT}`,
    `fps=${FPS}`,
    `trim=duration=${duration.toFixed(12)}`,
    "setpts=PTS-STARTPTS",
    "setsar=1",
  ].join(",");
}

async function renderVisualSegment(plan, destination) {
  const ffmpeg = ffmpegPath("ffmpeg");
  const args = ["-y"];

  if (plan.mode === "trim" && plan.sourceOffset > 0.001) {
    args.push("-ss", plan.sourceOffset.toFixed(6));
  }
  if (plan.mode === "loop") {
    args.push("-stream_loop", "-1");
  }
  args.push(
    "-i", plan.asset.filePath,
    "-an",
    "-vf", videoFilter({ speed: plan.speed, duration: plan.targetDuration }),
    "-frames:v", String(plan.frameCount),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    destination
  );
  await runCommand(ffmpeg, args, `Rendering ${plan.id}`);
}

function concatLine(filePath) {
  const escaped = path.resolve(filePath).split(path.sep).join("/").replaceAll("'", "'\\''");
  return `file '${escaped}'`;
}

function assTime(seconds) {
  const total = Math.max(0, Math.round(seconds * 100));
  const centiseconds = total % 100;
  const totalSeconds = Math.floor(total / 100);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(text, maxChars = 13) {
  const compact = String(text).replace(/\r?\n/g, "").trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
  const chunks = [];
  for (let index = 0; index < compact.length; index += maxChars) {
    chunks.push(compact.slice(index, index + maxChars));
  }
  return chunks.join("\\N");
}

async function writeAss(captionCues, voiceDuration, assPath) {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Caption,${process.env.SUBTITLE_FONT || "Meiryo"},72,&H00FFFFFF,&H000000FF,&H00101010,&H70000000,1,0,0,0,100,100,0,0,1,7,1,2,60,60,270,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  const lines = captionCues
    .filter((cue) => cue.start < voiceDuration)
    .map((cue) => {
      const end = Math.min(cue.end, voiceDuration);
      return `Dialogue: 0,${assTime(cue.start)},${assTime(end)},Caption,,0,0,0,,${escapeAssText(cue.text)}`;
    });

  await fsp.writeFile(assPath, `${[...header, ...lines].join("\n")}\n`, "utf8");
}

function escapeFilterPath(filePath) {
  return path.resolve(filePath)
    .split(path.sep).join("/")
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll(",", "\\,");
}

async function concatAndBurnSubtitles(segmentPaths, assPath, voicePath, outputPath, voiceDuration) {
  const ffmpeg = ffmpegPath("ffmpeg");
  const tempDir = path.dirname(segmentPaths[0]);
  const concatPath = path.join(tempDir, "concat.txt");
  await fsp.writeFile(concatPath, `${segmentPaths.map(concatLine).join("\n")}\n`, "utf8");

  const subtitleFile = escapeFilterPath(assPath);
  const fontDir = "C:/Windows/Fonts";
  const fontClause = process.platform === "win32" && fs.existsSync(fontDir)
    ? `:fontsdir='${escapeFilterPath(fontDir)}'`
    : "";
  const filter = `[0:v]subtitles=filename='${subtitleFile}'${fontClause}[v]`;

  await runCommand(
    ffmpeg,
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,
      "-i", voicePath,
      "-filter_complex", filter,
      "-map", "[v]",
      "-map", "1:a:0",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      "-c:a", "aac",
      "-b:a", "192k",
      "-t", voiceDuration.toFixed(6),
      "-movflags", "+faststart",
      outputPath,
    ],
    "Concatenating visual segments and burning captions"
  );
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

async function main() {
  const timelinePath = firstExisting(
    [
      process.env.TIMELINE_PATH,
      "output/timeline_with_captions.json",
    ],
    "Timeline JSON"
  );
  const manifestPath = firstExisting(
    [
      process.env.ASSET_MANIFEST_PATH,
      "assets/asset_manifest.json",
      "asset_manifest.json",
      "output/asset_manifest.json",
      "config/asset_manifest.json",
    ],
    "asset_manifest.json"
  );
  const voicePath = firstExisting(
    [
      process.env.VOICE_PATH,
      "input/voice.mp3",
      "input/voice.wav",
    ],
    "Voice audio"
  );

  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const rawTimeline = readJson(timelinePath, "Timeline JSON");
  const rawManifest = readJson(manifestPath, "asset_manifest.json");
  const { segments, captionCues } = normalizeTimeline(rawTimeline);
  const { assets, skipped } = await normalizeAssetManifest(rawManifest, manifestPath);
  const voiceDuration = await probeDuration(voicePath);
  const warnings = [];

  const timelineEnd = segments.at(-1).end;
  if (Math.abs(timelineEnd - voiceDuration) > 0.12) {
    warnings.push(
      `Timeline end (${timelineEnd.toFixed(3)}s) and voice duration (${voiceDuration.toFixed(3)}s) differ by more than 120ms. The final MP4 follows the voice duration.`
    );
  }
  const finalCueEnd = captionCues.length ? captionCues.at(-1).end : 0;
  if (Math.abs(finalCueEnd - voiceDuration) > 0.12) {
    warnings.push(
      `Final caption cue ends at ${finalCueEnd.toFixed(3)}s while voice is ${voiceDuration.toFixed(3)}s.`
    );
  }

  const folderCounts = new Map();
  const roleCounts = new Map();
  for (const asset of assets) {
    folderCounts.set(asset.folder, (folderCounts.get(asset.folder) || 0) + 1);
    for (const role of asset.roles) {
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    }
  }
  const manifestCheck = {
    manifest: projectPath(manifestPath),
    valid_video_count: assets.length,
    skipped_count: skipped.length,
    folders: [...folderCounts.entries()].map(([folder, count]) => ({ folder, count })),
    role_counts: Object.fromEntries(roleCounts),
    skipped: skipped.slice(0, 50),
  };
  await fsp.writeFile(
    path.join(OUTPUT_DIR, "asset_manifest_check.json"),
    `${JSON.stringify(manifestCheck, null, 2)}\n`,
    "utf8"
  );

  const assignments = await assignAssets(segments, assets, warnings);
  const plan = framePlan(assignments, voiceDuration);

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "picoedit_timeline_"));
  const assPath = path.join(OUTPUT_DIR, "rough_cut_subtitles.ass");
  const outputPath = path.join(OUTPUT_DIR, "rough_cut.mp4");

  try {
    await writeAss(captionCues, voiceDuration, assPath);
    const segmentPaths = [];
    for (const [index, item] of plan.entries()) {
      const segmentPath = path.join(tempDir, `${String(index).padStart(2, "0")}_${item.id}.mp4`);
      await renderVisualSegment(item, segmentPath);
      segmentPaths.push(segmentPath);
    }
    await concatAndBurnSubtitles(segmentPaths, assPath, voicePath, outputPath, voiceDuration);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  const outputDuration = await probeDuration(outputPath);
  const roughCutPlan = {
    version: 1,
    inputs: {
      timeline: projectPath(timelinePath),
      manifest: projectPath(manifestPath),
      voice: projectPath(voicePath),
    },
    output: projectPath(outputPath),
    settings: { width: WIDTH, height: HEIGHT, fps: FPS },
    voice_duration: round(voiceDuration),
    output_duration: round(outputDuration),
    warnings,
    segments: plan.map((item) => ({
      id: item.id,
      role: item.role,
      start: round(item.start),
      end: round(item.end),
      timeline_duration: round(item.timelineDuration),
      frame_start: item.frameStart,
      frame_end: item.frameEnd,
      rendered_duration: round(item.targetDuration),
      asset: item.asset.projectPath,
      source_duration: round(item.sourceDuration),
      render_mode: item.mode,
      speed: round(item.speed),
      source_offset: round(item.sourceOffset),
    })),
  };
  await fsp.writeFile(
    path.join(OUTPUT_DIR, "rough_cut_plan.json"),
    `${JSON.stringify(roughCutPlan, null, 2)}\n`,
    "utf8"
  );

  console.log("\nPicoEdit timeline rough cut completed.");
  console.log(`Voice:  ${voiceDuration.toFixed(3)}s`);
  console.log(`Output: ${outputDuration.toFixed(3)}s`);
  console.log(`Assets: ${assets.length} valid videos from ${projectPath(manifestPath)}`);
  console.log(`Video:  ${projectPath(outputPath)}`);
  console.log(`Plan:   output/rough_cut_plan.json`);
  console.log(`Check:  output/asset_manifest_check.json`);
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

main().catch((error) => {
  console.error("\nPicoEdit timeline rough cut failed.");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

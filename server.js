const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = __dirname;
const WEB_ROOT = path.join(PROJECT_ROOT, "web");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
const TEMPLATE_DIR = path.join(PROJECT_ROOT, "templates");
const ASSET_DIR = path.join(PROJECT_ROOT, "assets");
const INPUT_DIR = path.join(PROJECT_ROOT, "input");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv"]);
const PORT = Number(process.env.PORT || 8765);

let renderInProgress = false;

function toProjectPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative.split(path.sep).join("/");
}

function fromProjectPath(projectPath) {
  return path.resolve(PROJECT_ROOT, projectPath);
}

function assertInsideRoot(filePath, root = PROJECT_ROOT) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path is outside the project root.");
  }
  return resolved;
}

function isVideo(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function ffmpegPath(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const bundled = path.join(PROJECT_ROOT, "tools", "ffmpeg", "bin", exe);
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return exe;
}

async function runCommand(command, args, context) {
  try {
    return await execFileAsync(command, args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 80,
    });
  } catch (error) {
    const output = `${error.stderr || ""}${error.stdout || ""}`.trim();
    throw new Error(`${context} failed:\n${output || error.message}`);
  }
}

async function probeDuration(ffprobe, filePath) {
  const result = await runCommand(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    `ffprobe for ${toProjectPath(filePath)}`
  );
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Video duration is invalid: ${toProjectPath(filePath)}`);
  }
  return duration;
}

function validateTemplate(template) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("Template must be a JSON object.");
  }
  for (const key of ["template_id", "output_size", "fps", "slots"]) {
    if (!(key in template)) {
      throw new Error(`Template is missing required field: ${key}`);
    }
  }
  const [widthText, heightText] = String(template.output_size).toLowerCase().split("x");
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  const fps = Number.parseFloat(template.fps);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(fps)) {
    throw new Error("Template output_size and fps must be valid numbers.");
  }
  if (width <= 0 || height <= 0 || fps <= 0) {
    throw new Error("Template output_size and fps must be greater than zero.");
  }
  if (!Array.isArray(template.slots) || template.slots.length === 0) {
    throw new Error("Template slots must be a non-empty array.");
  }

  const slots = template.slots.map((slot, index) => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
      throw new Error(`Slot #${index + 1} must be a JSON object.`);
    }
    for (const key of ["slot_id", "label", "folder", "target_duration"]) {
      if (!(key in slot)) {
        throw new Error(`Slot #${index + 1} is missing required field: ${key}`);
      }
    }
    const targetDuration = Number.parseFloat(slot.target_duration);
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      throw new Error(`Slot '${slot.slot_id}' target_duration must be greater than zero.`);
    }
    const folder = fromProjectPath(String(slot.folder));
    assertInsideRoot(folder, ASSET_DIR);
    return {
      slot_id: String(slot.slot_id),
      label: String(slot.label),
      folder: toProjectPath(folder),
      target_duration: targetDuration,
    };
  });

  return {
    template_id: String(template.template_id),
    output_size: `${width}x${height}`,
    fps,
    slots,
    _width: width,
    _height: height,
  };
}

async function listVideoFiles(folderPath) {
  const entries = await fsp.readdir(folderPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(folderPath, entry.name))
    .filter(isVideo)
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en"));
}

async function findAsset(ffprobe, folderPath, targetDuration, usedAssets, slotId) {
  const videos = await listVideoFiles(folderPath);
  if (videos.length === 0) {
    throw new Error(`No video files were found in asset folder: ${toProjectPath(folderPath)}`);
  }
  const unused = videos.filter((filePath) => !usedAssets.has(path.resolve(filePath)));
  if (unused.length === 0) {
    throw new Error(`No unused videos remain in asset folder: ${toProjectPath(folderPath)}`);
  }

  let fallback = null;
  for (const candidate of unused) {
    const duration = await probeDuration(ffprobe, candidate);
    fallback ||= { filePath: candidate, duration };
    if (duration >= targetDuration) {
      return { filePath: candidate, duration, warning: null };
    }
  }

  return {
    ...fallback,
    warning: `Slot '${slotId}' has no unused asset at least ${targetDuration.toFixed(3)}s long. Using ${toProjectPath(fallback.filePath)} at normal speed.`,
  };
}

function selectedAssetPath(assetSelections, slotId) {
  if (!assetSelections || typeof assetSelections !== "object") {
    return null;
  }
  const selection = assetSelections[slotId];
  if (!selection) {
    return null;
  }
  const filePath = assertInsideRoot(fromProjectPath(String(selection)), ASSET_DIR);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !isVideo(filePath)) {
    throw new Error(`Selected asset is not a video file: ${selection}`);
  }
  return filePath;
}

async function selectSlotAsset(ffprobe, slot, usedAssets, assetSelections) {
  const manualAsset = selectedAssetPath(assetSelections, slot.slot_id);
  if (manualAsset) {
    const duration = await probeDuration(ffprobe, manualAsset);
    const warning =
      duration < slot.target_duration
        ? `Slot '${slot.slot_id}' selected asset is shorter than ${slot.target_duration.toFixed(3)}s: ${toProjectPath(manualAsset)}`
        : null;
    return { filePath: manualAsset, duration, warning, manual: true };
  }

  const folderPath = fromProjectPath(slot.folder);
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Asset folder does not exist: ${slot.folder}`);
  }
  const selected = await findAsset(
    ffprobe,
    folderPath,
    slot.target_duration,
    usedAssets,
    slot.slot_id
  );
  usedAssets.add(path.resolve(selected.filePath));
  return { ...selected, manual: false };
}

async function defaultSlotSelections(rawTemplate) {
  const template = validateTemplate(rawTemplate);
  const ffprobe = ffmpegPath("ffprobe");
  const usedAssets = new Set();
  const selections = [];
  const warnings = [];

  for (const slot of template.slots) {
    const selected = await selectSlotAsset(ffprobe, slot, usedAssets, null);
    if (selected.warning) {
      warnings.push(selected.warning);
    }
    selections.push({
      slot_id: slot.slot_id,
      asset: toProjectPath(selected.filePath),
      assetName: path.basename(selected.filePath),
      url: `/media/${toProjectPath(selected.filePath)}`,
      duration: Number(selected.duration.toFixed(6)),
    });
  }

  return { selections, warnings };
}

async function makeSegment(options) {
  const {
    ffmpeg,
    ffprobe,
    source,
    destination,
    speed,
    duration,
    width,
    height,
    fps,
    slotId,
  } = options;
  const videoFilter = [
    `setpts=(PTS-STARTPTS)/${speed.toFixed(12)}`,
    `trim=duration=${duration.toFixed(12)}`,
    "setpts=PTS-STARTPTS",
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `fps=${fps}`,
    "setsar=1",
  ].join(",");

  await runCommand(
    ffmpeg,
    [
      "-y",
      "-i",
      source,
      "-an",
      "-vf",
      videoFilter,
      "-t",
      duration.toFixed(12),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      destination,
    ],
    `FFmpeg segment build for slot '${slotId}'`
  );
  return probeDuration(ffprobe, destination);
}

function concatLine(filePath) {
  const escaped = path.resolve(filePath).split(path.sep).join("/").replaceAll("'", "'\\''");
  return `file '${escaped}'`;
}

async function concatSegments(ffmpeg, concatFile, outputPath, voicePath, videoDuration) {
  const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatFile];
  if (fs.existsSync(voicePath)) {
    args.push(
      "-i",
      voicePath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-t",
      videoDuration.toFixed(12)
    );
  } else {
    args.push("-c", "copy");
  }
  args.push("-movflags", "+faststart", outputPath);
  await runCommand(ffmpeg, args, "FFmpeg final concatenation");
}

function csvValue(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function writeOutputs(templateId, segments) {
  const timeline = {
    template_id: templateId,
    output: "output/rough_cut.mp4",
    segments,
  };
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.writeFile(
    path.join(OUTPUT_DIR, "timeline.json"),
    `${JSON.stringify(timeline, null, 2)}\n`,
    "utf8"
  );

  const fields = ["slot_id", "label", "start", "end", "duration", "folder", "asset", "speed"];
  const csv = [
    fields.join(","),
    ...segments.map((segment) => fields.map((field) => csvValue(segment[field])).join(",")),
  ].join("\r\n");
  await fsp.writeFile(path.join(OUTPUT_DIR, "edit_list.csv"), `\uFEFF${csv}\r\n`, "utf8");
  return timeline;
}

async function buildRoughCut(rawTemplate, assetSelections = null) {
  const template = validateTemplate(rawTemplate);
  const ffmpeg = ffmpegPath("ffmpeg");
  const ffprobe = ffmpegPath("ffprobe");
  const outputPath = path.join(OUTPUT_DIR, "rough_cut.mp4");
  const voicePath = path.join(INPUT_DIR, "voice.wav");
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "picoedit_"));
  const usedAssets = new Set();
  const segments = [];
  const warnings = [];
  const segmentPaths = [];
  let currentStart = 0;

  try {
    for (const [index, slot] of template.slots.entries()) {
      const selected = await selectSlotAsset(ffprobe, slot, usedAssets, assetSelections);
      if (selected.warning) {
        warnings.push(selected.warning);
      }

      const speed = Math.max(selected.duration / slot.target_duration, 1);
      const intendedDuration = Math.min(selected.duration, slot.target_duration);
      const segmentPath = path.join(tempDir, `${String(index).padStart(3, "0")}_${slot.slot_id}.mp4`);
      const actualDuration = await makeSegment({
        ffmpeg,
        ffprobe,
        source: selected.filePath,
        destination: segmentPath,
        speed,
        duration: intendedDuration,
        width: template._width,
        height: template._height,
        fps: template.fps,
        slotId: slot.slot_id,
      });
      segmentPaths.push(segmentPath);

      const end = currentStart + actualDuration;
      segments.push({
        slot_id: slot.slot_id,
        label: slot.label,
        start: Number(currentStart.toFixed(6)),
        end: Number(end.toFixed(6)),
        duration: Number(actualDuration.toFixed(6)),
        folder: toProjectPath(path.dirname(selected.filePath)),
        asset: toProjectPath(selected.filePath),
        speed: Number(speed.toFixed(6)),
      });
      currentStart = end;
    }

    const concatFile = path.join(tempDir, "concat.txt");
    await fsp.writeFile(concatFile, `${segmentPaths.map(concatLine).join("\n")}\n`, "utf8");
    await concatSegments(ffmpeg, concatFile, outputPath, voicePath, currentStart);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  const timeline = await writeOutputs(template.template_id, segments);
  return {
    timeline,
    warnings,
    outputUrl: `/media/output/rough_cut.mp4?v=${Date.now()}`,
  };
}

async function listTemplates() {
  await fsp.mkdir(TEMPLATE_DIR, { recursive: true });
  const entries = await fsp.readdir(TEMPLATE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function readTemplate(templateName) {
  const safeName = path.basename(templateName || "ai_prompt_30s.json");
  const templatePath = assertInsideRoot(path.join(TEMPLATE_DIR, safeName), TEMPLATE_DIR);
  const text = await fsp.readFile(templatePath, "utf8");
  return JSON.parse(text);
}

async function saveTemplate(templateName, template) {
  const safeName = path.basename(templateName || "ai_prompt_30s.json");
  const templatePath = assertInsideRoot(path.join(TEMPLATE_DIR, safeName), TEMPLATE_DIR);
  const validated = validateTemplate(template);
  const cleanTemplate = {
    template_id: validated.template_id,
    output_size: validated.output_size,
    fps: validated.fps,
    slots: validated.slots,
  };
  await fsp.writeFile(templatePath, `${JSON.stringify(cleanTemplate, null, 2)}\n`, "utf8");
  return cleanTemplate;
}

async function walkAssets(dir = ASSET_DIR) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkAssets(child)));
    } else if (entry.isFile() && isVideo(child)) {
      const stat = await fsp.stat(child);
      files.push({
        path: toProjectPath(child),
        name: entry.name,
        folder: toProjectPath(path.dirname(child)),
        size: stat.size,
        url: `/media/${toProjectPath(child)}`,
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

async function assetSummary() {
  const assets = await walkAssets();
  const folders = new Map();
  for (const asset of assets) {
    if (!folders.has(asset.folder)) {
      folders.set(asset.folder, []);
    }
    folders.get(asset.folder).push(asset);
  }
  return {
    count: assets.length,
    folders: [...folders.entries()].map(([folder, files]) => ({
      folder,
      count: files.length,
      files,
    })),
  };
}

async function readTimeline() {
  const timelinePath = path.join(OUTPUT_DIR, "timeline.json");
  if (!fs.existsSync(timelinePath)) {
    return null;
  }
  return JSON.parse(await fsp.readFile(timelinePath, "utf8"));
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
  }[ext] || "application/octet-stream";
}

async function serveFile(request, response, filePath) {
  const stat = await fsp.stat(filePath);
  const headers = {
    "content-type": contentType(filePath),
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
      if (start <= end && end < stat.size) {
        response.writeHead(206, {
          ...headers,
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${stat.size}`,
        });
        fs.createReadStream(filePath, { start, end }).pipe(response);
        return;
      }
    }
  }
  response.writeHead(200, { ...headers, "content-length": stat.size });
  fs.createReadStream(filePath).pipe(response);
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/state") {
    const templates = await listTemplates();
    sendJson(response, 200, {
      templates,
      assets: await assetSummary(),
      timeline: await readTimeline(),
      outputExists: fs.existsSync(path.join(OUTPUT_DIR, "rough_cut.mp4")),
    });
    return;
  }
  if (url.pathname === "/api/templates") {
    sendJson(response, 200, { templates: await listTemplates() });
    return;
  }
  if (url.pathname === "/api/assets") {
    sendJson(response, 200, await assetSummary());
    return;
  }
  if (url.pathname === "/api/timeline") {
    sendJson(response, 200, { timeline: await readTimeline() });
    return;
  }
  if (url.pathname === "/api/slot-selection" && request.method === "POST") {
    const body = await readRequestBody(request);
    const template = body.template || (await readTemplate(body.name));
    sendJson(response, 200, await defaultSlotSelections(template));
    return;
  }
  if (url.pathname === "/api/template" && request.method === "GET") {
    sendJson(response, 200, {
      name: url.searchParams.get("name") || "ai_prompt_30s.json",
      template: await readTemplate(url.searchParams.get("name")),
    });
    return;
  }
  if (url.pathname === "/api/template" && request.method === "PUT") {
    const body = await readRequestBody(request);
    sendJson(response, 200, {
      template: await saveTemplate(body.name, body.template),
    });
    return;
  }
  if (url.pathname === "/api/render" && request.method === "POST") {
    if (renderInProgress) {
      sendJson(response, 409, { error: "A render is already in progress." });
      return;
    }
    renderInProgress = true;
    try {
      const body = await readRequestBody(request);
      const template = body.template || (await readTemplate(body.name));
      sendJson(response, 200, await buildRoughCut(template, body.assetSelections));
    } finally {
      renderInProgress = false;
    }
    return;
  }
  sendJson(response, 404, { error: "Not found" });
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/media/")) {
      const relative = decodeURIComponent(url.pathname.slice("/media/".length));
      const filePath = assertInsideRoot(path.join(PROJECT_ROOT, relative), PROJECT_ROOT);
      await serveFile(request, response, filePath);
      return;
    }

    const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const filePath = assertInsideRoot(path.join(WEB_ROOT, relativePath), WEB_ROOT);
    await serveFile(request, response, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: error.message });
    } else {
      response.end();
    }
  }
}

const server = http.createServer(handleRequest);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`picoedit web app running at http://127.0.0.1:${PORT}/`);
});

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = __dirname;
const WEB_ROOT = path.join(PROJECT_ROOT, "web");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
const SELECTED_CLIPS_DIR = path.join(OUTPUT_DIR, "selected_clips");
const ASSET_DIR = path.join(PROJECT_ROOT, "assets");
const INPUT_DIR = path.join(PROJECT_ROOT, "input");
const CONFIG_DIR = path.join(PROJECT_ROOT, "config");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");
const ENV_PATH = path.join(PROJECT_ROOT, ".env");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv"]);
const PORT = Number(process.env.PORT || 8765);
const ELEVENLABS_MODEL_ID = "eleven_v3";
const ASSET_CATALOG_URL = "https://pub-78d5d49156194b43ae62cc67bd6faf88.r2.dev/asset_catalog.json";
const ASSET_CATALOG_HOST = "pub-78d5d49156194b43ae62cc67bd6faf88.r2.dev";
const ASSET_CATALOG_PATH = "/asset_catalog.json";
const ASSET_CATALOG_TIMEOUT_MS = 8000;
const ASSET_CATALOG_MAX_BYTES = 1024 * 1024;
const ASSET_PACK_MAX_BYTES = 1024 * 1024 * 600;
const ASSET_MANIFEST_PATH = path.join(ASSET_DIR, "asset_manifest.json");
const ASSET_PACK_HOST = ASSET_CATALOG_HOST;
const ASSET_PACK_PATH_PREFIX = "/packs/";

let voiceInProgress = false;
let timelineRenderInProgress = false;

function loadEnvFileOnce() {
  if (!fs.existsSync(ENV_PATH) || typeof process.loadEnvFile !== "function") {
    return;
  }
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {
    // Fall back to the local parser below. Never expose .env contents.
  }
}

loadEnvFileOnce();

function toProjectPath(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative.split(path.sep).join("/");
}

function assertInsideRoot(filePath, root = PROJECT_ROOT) {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path is outside the project root.");
  }
  return resolved;
}

function parseDotEnv(text) {
  const values = {};
  for (const line of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim().replace(/^\uFEFF/, "");
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    return {};
  }
  return parseDotEnv(await fsp.readFile(ENV_PATH, "utf8"));
}

async function elevenLabsConfig() {
  const localEnv = await readLocalEnv();
  return {
    apiKey: localEnv.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || "",
    voiceId: localEnv.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || "",
    modelId: localEnv.ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || ELEVENLABS_MODEL_ID,
  };
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

function defaultSettings() {
  return {
    asset_catalog_url: ASSET_CATALOG_URL,
  };
}

function assertAllowedAssetCatalogUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("素材カタログURLの形式が正しくありません。");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ASSET_CATALOG_HOST ||
    parsed.pathname !== ASSET_CATALOG_PATH ||
    parsed.search ||
    parsed.hash ||
    parsed.href !== ASSET_CATALOG_URL
  ) {
    throw new Error("このバージョンでは指定された素材カタログURLだけを利用できます。");
  }
  return parsed.href;
}

function assertAllowedArchiveUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error("素材パックの配布URLの形式が正しくありません。管理者に連絡してください");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ASSET_PACK_HOST ||
    !parsed.pathname.startsWith(ASSET_PACK_PATH_PREFIX) ||
    !parsed.pathname.endsWith(".zip") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("素材パックの配布URLが許可されていません。管理者に連絡してください");
  }
  return parsed.href;
}

async function readAssetManifest() {
  if (!fs.existsSync(ASSET_MANIFEST_PATH)) {
    return { packs: [] };
  }
  const manifest = JSON.parse(await fsp.readFile(ASSET_MANIFEST_PATH, "utf8"));
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.packs)) {
    return { packs: [] };
  }
  return manifest;
}

async function writeAssetManifest(manifest) {
  await fsp.mkdir(ASSET_DIR, { recursive: true });
  await fsp.writeFile(ASSET_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function installedPackFor(pack) {
  const manifest = await readAssetManifest();
  const manifestEntry = manifest.packs.find((entry) => entry.id === pack.id);
  if (manifestEntry) {
    return manifestEntry;
  }

  const installDir = typeof pack.install_dir === "string" && pack.install_dir ? pack.install_dir : pack.id;
  const packPath = path.join(ASSET_DIR, installDir, "pack.json");
  if (!fs.existsSync(packPath)) {
    return null;
  }
  try {
    const installedPack = JSON.parse(await fsp.readFile(packPath, "utf8"));
    if (installedPack.id === pack.id) {
      return {
        id: installedPack.id,
        version: installedPack.version,
        install_dir: installedPack.install_dir || installDir,
        videos: [],
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function withInstallStatus(catalog) {
  const packs = await Promise.all(
    catalog.packs.map(async (pack) => {
      const installed = await installedPackFor(pack);
      return {
        ...pack,
        installed: Boolean(installed && installed.version === pack.version),
        installed_version: installed?.version || null,
        install_dir: pack.install_dir || installed?.install_dir || pack.id,
        video_count: installed?.videos?.length || 0,
      };
    })
  );
  return { ...catalog, packs };
}

async function readSettings() {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_PATH)) {
    const settings = defaultSettings();
    await writeSettings(settings);
    return settings;
  }

  const rawSettings = JSON.parse(await fsp.readFile(SETTINGS_PATH, "utf8"));
  const settings = {
    ...defaultSettings(),
    ...(rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings) ? rawSettings : {}),
  };
  settings.asset_catalog_url = assertAllowedAssetCatalogUrl(settings.asset_catalog_url);
  return settings;
}

async function writeSettings(settings) {
  const cleanSettings = {
    asset_catalog_url: assertAllowedAssetCatalogUrl(settings.asset_catalog_url),
  };
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.writeFile(SETTINGS_PATH, `${JSON.stringify(cleanSettings, null, 2)}\n`, "utf8");
  return cleanSettings;
}

async function readResponseTextWithLimit(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("素材カタログの形式が正しくありません。管理者に連絡してください");
    }
    return text;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("素材カタログの形式が正しくありません。管理者に連絡してください");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchAssetCatalog(settings = null) {
  const activeSettings = settings || (await readSettings());
  const catalogUrl = assertAllowedAssetCatalogUrl(activeSettings.asset_catalog_url);
  let response;
  try {
    response = await fetch(catalogUrl, {
      signal: AbortSignal.timeout(ASSET_CATALOG_TIMEOUT_MS),
    });
  } catch {
    throw new Error("素材カタログに接続できません。ネット接続と配布URLを確認してください");
  }

  if (!response.ok) {
    throw new Error("素材カタログに接続できません。ネット接続と配布URLを確認してください");
  }

  let catalog;
  try {
    catalog = JSON.parse(await readResponseTextWithLimit(response, ASSET_CATALOG_MAX_BYTES));
  } catch (error) {
    if (String(error.message || "").startsWith("素材カタログ")) {
      throw error;
    }
    throw new Error("素材カタログの形式が正しくありません。管理者に連絡してください");
  }

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || !Array.isArray(catalog.packs)) {
    throw new Error("素材カタログの形式が正しくありません。管理者に連絡してください");
  }

  return {
    ...catalog,
    packs: catalog.packs,
    message: catalog.packs.length ? `${catalog.packs.length}件の素材パックがあります` : "利用可能な素材パックはありません",
  };
}

async function downloadFileWithLimit(url, destination, maxBytes) {
  let response;
  try {
    response = await fetch(assertAllowedArchiveUrl(url), {
      signal: AbortSignal.timeout(ASSET_CATALOG_TIMEOUT_MS),
    });
  } catch {
    throw new Error("素材パックをダウンロードできません。ネット接続を確認して、もう一度試してください");
  }
  if (!response.ok) {
    throw new Error("素材パックをダウンロードできません。配布ファイルが見つからない可能性があります");
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error("素材パックが大きすぎます。管理者に連絡してください");
    }
    await fsp.writeFile(destination, buffer);
    return;
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const output = fs.createWriteStream(destination);
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error("素材パックが大きすぎます。管理者に連絡してください");
      }
      output.write(Buffer.from(value));
    }
  } finally {
    await new Promise((resolve) => output.end(resolve));
  }
}

function normalizeZipEntryName(name) {
  const normalized = String(name || "").replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error("素材パックの中に安全でないファイルパスがあります。管理者に連絡してください");
  }
  if (/(^|\/)(\.DS_Store|Thumbs\.db|node_modules|output|cache)(\/|$)/i.test(normalized)) {
    throw new Error("素材パックに不要なファイルが含まれています。管理者に連絡してください");
  }
  return normalized;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("素材パックのZIPを読み取れません。ファイルが壊れている可能性があります");
}

async function extractZipSafely(zipPath, destination) {
  const destinationRoot = path.resolve(destination);
  const buffer = await fsp.readFile(zipPath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = centralDirectoryOffset;

  await fsp.mkdir(destinationRoot, { recursive: true });

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("素材パックのZIPを読み取れません。ファイルが壊れている可能性があります");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const entryName = normalizeZipEntryName(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (entryName.endsWith("/")) {
      await fsp.mkdir(path.join(destinationRoot, entryName), { recursive: true });
      continue;
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("素材パックのZIPを読み取れません。ファイルが壊れている可能性があります");
    }
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let content;
    if (method === 0) {
      content = compressed;
    } else if (method === 8) {
      content = zlib.inflateRawSync(compressed);
    } else {
      throw new Error("素材パックのZIP形式に対応していません。管理者に連絡してください");
    }
    if (content.length !== uncompressedSize) {
      throw new Error("素材パックのZIPを読み取れません。ファイルが壊れている可能性があります");
    }

    const target = path.resolve(destinationRoot, ...entryName.split("/"));
    if (target !== destinationRoot && !target.startsWith(destinationRoot + path.sep)) {
      throw new Error("素材パックの中に安全でないファイルパスがあります。管理者に連絡してください");
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }
}

function validatePackJson(packJson, expectedPack) {
  if (!packJson || typeof packJson !== "object" || Array.isArray(packJson)) {
    throw new Error("素材パックの情報が正しくありません。管理者に連絡してください");
  }
  if (packJson.id !== expectedPack.id) {
    throw new Error("素材パックのIDがカタログと一致しません。管理者に連絡してください");
  }
  if (packJson.version !== expectedPack.version) {
    throw new Error("素材パックのバージョンがカタログと一致しません。管理者に連絡してください");
  }
  const installDir = String(packJson.install_dir || "").trim();
  if (!installDir || installDir.includes("/") || installDir.includes("\\") || installDir.includes("..")) {
    throw new Error("素材パックのインストール先が正しくありません。管理者に連絡してください");
  }
  return { ...packJson, install_dir: installDir };
}

async function walkVideos(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkVideos(child)));
    } else if (entry.isFile() && isVideo(child)) {
      files.push(child);
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function parseFps(value) {
  const [numeratorText, denominatorText] = String(value || "").split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText || 1);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? Number((numerator / denominator).toFixed(6))
    : null;
}

async function probeVideoMetadata(ffprobe, filePath, rootForRelativePath, installedRoot = null) {
  let result;
  try {
    result = await runCommand(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,duration:format=duration,size",
        "-of",
        "json",
        filePath,
      ],
      `ffprobe for ${filePath}`
    );
  } catch {
    throw new Error("動画情報を読み取れません。FFmpeg/ffprobeを確認して、もう一度試してください");
  }
  const info = JSON.parse(result.stdout);
  const stream = info.streams?.[0] || {};
  const width = Number(stream.width);
  const height = Number(stream.height);
  const duration = Number(stream.duration || info.format?.duration);
  const fileSize = Number(info.format?.size || (await fsp.stat(filePath)).size);
  const relativeSource = path.relative(rootForRelativePath, filePath).split(path.sep).join("/");
  const relativePath = installedRoot
    ? path.join(path.basename(installedRoot), relativeSource).split(path.sep).join("/")
    : relativeSource;
  return {
    path: relativePath,
    duration: Number.isFinite(duration) ? Number(duration.toFixed(6)) : null,
    fps: parseFps(stream.r_frame_rate),
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    aspect_ratio: Number.isFinite(width) && Number.isFinite(height) && height > 0 ? `${width}:${height}` : null,
    file_size: fileSize,
  };
}

async function installAssetPack(packId) {
  const catalog = await fetchAssetCatalog();
  const pack = catalog.packs.find((item) => item.id === packId);
  if (!pack) {
    throw new Error("指定された素材パックが見つかりません。素材カタログを再読み込みしてください");
  }
  const installed = await installedPackFor(pack);
  if (installed && installed.version === pack.version) {
    return {
      status: "installed",
      message: "導入済みです",
      pack: {
        id: pack.id,
        version: pack.version,
        name: pack.name,
        install_dir: installed.install_dir,
      },
      video_count: installed.videos?.length || 0,
      manifest_path: toProjectPath(ASSET_MANIFEST_PATH),
    };
  }
  if (installed) {
    throw new Error("別バージョンの素材パックが既にあります。上書きせず、管理者に確認してください");
  }

  const archiveUrl = assertAllowedArchiveUrl(pack.archive_url);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "picoedit_pack_"));
  const zipPath = path.join(tempDir, "pack.zip");
  const stagingDir = path.join(tempDir, "staging");
  try {
    await downloadFileWithLimit(archiveUrl, zipPath, ASSET_PACK_MAX_BYTES);
    await extractZipSafely(zipPath, stagingDir);

    const packJsonPath = path.join(stagingDir, "pack.json");
    if (!fs.existsSync(packJsonPath)) {
      throw new Error("素材パックの情報ファイルが見つかりません。管理者に連絡してください");
    }
    const packJsonText = (await fsp.readFile(packJsonPath, "utf8")).replace(/^\uFEFF/, "");
    let rawPackJson;
    try {
      rawPackJson = JSON.parse(packJsonText);
    } catch {
      throw new Error("素材パックの情報ファイルが正しくありません。管理者に連絡してください");
    }
    const packJson = validatePackJson(rawPackJson, pack);
    const finalDir = assertInsideRoot(path.join(ASSET_DIR, packJson.install_dir), ASSET_DIR);
    if (fs.existsSync(finalDir)) {
      throw new Error("同じ保存先の素材パックが既にあります。上書きせず、管理者に確認してください");
    }

    const videos = await walkVideos(stagingDir);
    if (videos.length === 0) {
      throw new Error("素材パックに動画が入っていません。管理者に連絡してください");
    }

    const ffprobe = ffmpegPath("ffprobe");
    const installedRoot = path.join(ASSET_DIR, packJson.install_dir);
    const videoMetadata = [];
    for (const video of videos) {
      videoMetadata.push(await probeVideoMetadata(ffprobe, video, stagingDir, installedRoot));
    }

    const manifest = await readAssetManifest();
    const installedAt = new Date().toISOString();
    manifest.packs = manifest.packs.filter((entry) => entry.id !== packJson.id);
    manifest.packs.push({
      id: packJson.id,
      version: packJson.version,
      name: packJson.name,
      description: packJson.description,
      install_dir: packJson.install_dir,
      installed_at: installedAt,
      videos: videoMetadata,
    });

    await fsp.mkdir(ASSET_DIR, { recursive: true });
    await fsp.rename(stagingDir, finalDir);
    await writeAssetManifest(manifest);

    return {
      status: "installed_now",
      message: `${packJson.name}を導入しました。動画本数: ${videoMetadata.length}本`,
      pack: {
        id: packJson.id,
        version: packJson.version,
        name: packJson.name,
        install_dir: packJson.install_dir,
      },
      video_count: videoMetadata.length,
      manifest_path: toProjectPath(ASSET_MANIFEST_PATH),
    };
  } catch (error) {
    if (String(error.message || "").includes("ffprobe")) {
      throw new Error("動画情報を読み取れません。FFmpeg/ffprobeを確認して、もう一度試してください");
    }
    throw error;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
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

function voiceAudioPath() {
  return path.join(INPUT_DIR, "voice.mp3");
}

function voiceTimestampsPath() {
  return path.join(OUTPUT_DIR, "elevenlabs_timestamps.json");
}

function existingVoicePath() {
  const candidates = [
    path.join(INPUT_DIR, "voice.wav"),
    path.join(INPUT_DIR, "voice.mp3"),
    path.join(INPUT_DIR, "voice.m4a"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function estimateAlignmentDuration(timestamps) {
  const ends = timestamps?.normalizedAlignment?.characterEndTimesSeconds ||
    timestamps?.alignment?.characterEndTimesSeconds ||
    [];
  const last = Number(ends[ends.length - 1]);
  return Number.isFinite(last) ? Number(last.toFixed(6)) : null;
}

function scriptOutputPath() {
  return path.join(OUTPUT_DIR, "script_timed.json");
}

function scriptInputCandidates() {
  return [
    path.join(PROJECT_ROOT, "script.json"),
    path.join(INPUT_DIR, "script.json"),
  ];
}

async function readScriptSource(timestamps) {
  for (const candidate of scriptInputCandidates()) {
    if (fs.existsSync(candidate)) {
      const script = JSON.parse(await fsp.readFile(candidate, "utf8"));
      return {
        path: candidate,
        script,
        derived: false,
      };
    }
  }

  const lines = String(timestamps.text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error("script.jsonが見つからず、timestamps内にも台本文がありません");
  }
  return {
    path: null,
    derived: true,
    script: {
      id: "derived_from_elevenlabs_timestamps",
      segments: lines.map((text, index) => ({
        id: `segment_${String(index + 1).padStart(2, "0")}`,
        text,
      })),
    },
  };
}

function scriptSegments(script) {
  const segments = Array.isArray(script) ? script : script?.segments;
  if (!Array.isArray(segments) || !segments.length) {
    throw new Error("script.jsonにsegments配列がありません");
  }
  return segments;
}

function segmentText(segment) {
  if (typeof segment === "string") {
    return segment.trim();
  }
  const text =
    segment?.text ??
    segment?.script ??
    segment?.dialogue ??
    segment?.line ??
    (typeof segment?.caption === "string" ? segment.caption : segment?.caption?.text);
  return String(text || "").trim();
}

function segmentId(segment, index) {
  if (segment && typeof segment === "object") {
    return String(segment.id || segment.segment_id || segment.slot_id || `segment_${String(index + 1).padStart(2, "0")}`);
  }
  return `segment_${String(index + 1).padStart(2, "0")}`;
}

function alignmentData(timestamps) {
  const alignment = timestamps.normalized_alignment || timestamps.normalizedAlignment || timestamps.alignment;
  const characters = alignment?.characters || [];
  const starts = alignment?.characterStartTimesSeconds || alignment?.character_start_times_seconds || [];
  const ends = alignment?.characterEndTimesSeconds || alignment?.character_end_times_seconds || [];
  if (!characters.length || characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error("timestampsの文字単位データが正しくありません");
  }
  return { characters, starts, ends };
}

function findCharacterSequence(characters, pattern, startIndex) {
  if (!pattern.length) {
    return -1;
  }
  for (let index = startIndex; index <= characters.length - pattern.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (characters[index + offset] !== pattern[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return index;
    }
  }
  return -1;
}

function timeValue(value) {
  return Number(Number(value).toFixed(6));
}

function withTiming(value, timing) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value, ...timing };
  }
  if (typeof value === "string") {
    return { text: value, ...timing };
  }
  return { ...timing };
}

function timedScriptShape(script, timedSegments, metadata) {
  const payload = Array.isArray(script) ? { segments: timedSegments } : { ...script, segments: timedSegments };
  return {
    ...payload,
    audio_path: metadata.audioPath,
    timestamps_path: metadata.timestampsPath,
    duration_sec: metadata.audioDuration,
    generated_at: new Date().toISOString(),
  };
}

async function mergeTimestampsIntoScript() {
  const timestampsPath = voiceTimestampsPath();
  if (!fs.existsSync(timestampsPath)) {
    throw new Error("timestamps JSONがありません。先に音声生成してください");
  }
  const timestamps = JSON.parse(await fsp.readFile(timestampsPath, "utf8"));
  const source = await readScriptSource(timestamps);
  const segments = scriptSegments(source.script);
  const alignment = alignmentData(timestamps);
  const matched = [];
  let cursor = 0;

  for (const [index, segment] of segments.entries()) {
    const text = segmentText(segment);
    if (!text) {
      throw new Error(`segment ${index + 1} のセリフが空です`);
    }
    const chars = Array.from(text);
    const startIndex = findCharacterSequence(alignment.characters, chars, cursor);
    if (startIndex < 0) {
      throw new Error(`segment ${index + 1} のセリフがtimestamps内で見つかりません`);
    }
    const endIndex = startIndex + chars.length - 1;
    matched.push({
      original: segment,
      id: segmentId(segment, index),
      text,
      rawStart: Number(alignment.starts[startIndex]),
      rawEnd: Number(alignment.ends[endIndex]),
      startIndex,
      endIndex,
    });
    cursor = endIndex + 1;
  }

  const audioPath = existingVoicePath();
  if (!audioPath) {
    throw new Error("音声ファイルが見つかりません。先に音声生成してください");
  }
  const ffprobe = ffmpegPath("ffprobe");
  const audioDuration = timeValue(await probeDuration(ffprobe, audioPath));

  const timedSegments = matched.map((item, index) => {
    const start = timeValue(index === 0 ? item.rawStart : matched[index].rawStart);
    const next = matched[index + 1];
    const end = timeValue(next ? next.rawStart : audioDuration);
    if (end < start) {
      throw new Error(`segment ${index + 1} の時間が前後しています`);
    }
    const durationSec = timeValue(end - start);
    const timing = {
      start,
      end,
      duration_sec: durationSec,
    };
    const base = item.original && typeof item.original === "object" && !Array.isArray(item.original)
      ? { ...item.original }
      : {};
    const videoSlot = base.video_slot ?? base.videoSlot ?? base.slot ?? base.slot_id ?? item.id;
    return {
      ...base,
      id: item.id,
      segment_id: item.id,
      slot_id: base.slot_id || item.id,
      label: base.label || item.text,
      text: item.text,
      start,
      end,
      duration: durationSec,
      duration_sec: durationSec,
      asset: base.asset || "",
      speed: Number(base.speed || 1),
      caption: withTiming(base.caption || item.text, timing),
      video_slot: withTiming(videoSlot, timing),
    };
  });

  for (let index = 1; index < timedSegments.length; index += 1) {
    const previous = timedSegments[index - 1];
    const current = timedSegments[index];
    if (Math.abs(previous.end - current.start) > 0.000001) {
      throw new Error(`segment ${index} と ${index + 1} の時間が連続していません`);
    }
  }
  const lastEnd = timedSegments[timedSegments.length - 1].end;
  const durationDiff = timeValue(Math.abs(lastEnd - audioDuration));
  if (durationDiff > 0.1) {
    throw new Error(`最後のsegmentと音声の長さが0.1秒以上ずれています: ${durationDiff.toFixed(3)}秒`);
  }

  const outputScriptPath = scriptOutputPath();
  const timelinePath = path.join(OUTPUT_DIR, "timeline.json");
  const metadata = {
    audioPath: toProjectPath(audioPath),
    timestampsPath: toProjectPath(timestampsPath),
    audioDuration,
  };
  const outputScript = timedScriptShape(source.script, timedSegments, metadata);
  const timeline = {
    template_id: outputScript.id || "script_timeline",
    source_script: source.path ? toProjectPath(source.path) : "derived_from_elevenlabs_timestamps",
    output_script: toProjectPath(outputScriptPath),
    timestamps: toProjectPath(timestampsPath),
    audio: {
      path: toProjectPath(audioPath),
      duration_sec: audioDuration,
    },
    duration_sec: audioDuration,
    segments: timedSegments,
    validation: {
      continuous: true,
      last_end_sec: lastEnd,
      audio_duration_sec: audioDuration,
      last_end_audio_diff_sec: durationDiff,
    },
  };

  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.writeFile(outputScriptPath, `${JSON.stringify(outputScript, null, 2)}\n`, "utf8");
  await fsp.writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
  return {
    message: "timestampsをセリフJSONへ結合しました",
    script_path: toProjectPath(outputScriptPath),
    timeline_path: toProjectPath(timelinePath),
    segment_count: timedSegments.length,
    audio_duration_sec: audioDuration,
    last_end_audio_diff_sec: durationDiff,
    source_script: timeline.source_script,
  };
}

async function voiceStatus() {
  const config = await elevenLabsConfig();
  const audioPath = voiceAudioPath();
  const timestampsPath = voiceTimestampsPath();
  return {
    configured: Boolean(config.apiKey && config.voiceId),
    api_key_configured: Boolean(config.apiKey),
    voice_id_configured: Boolean(config.voiceId),
    model_id: config.modelId,
    audio_exists: fs.existsSync(audioPath),
    audio_path: toProjectPath(audioPath),
    timestamps_path: toProjectPath(timestampsPath),
    audio_url: fs.existsSync(audioPath) ? `/media/${toProjectPath(audioPath)}?v=${Date.now()}` : null,
  };
}

async function generateElevenLabsVoice(text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    throw new Error("音声にする文章を入力してください");
  }
  if (cleanText.length > 5000) {
    throw new Error("文章が長すぎます。短く分けて音声生成してください");
  }

  const config = await elevenLabsConfig();
  if (!config.apiKey) {
    throw new Error("ElevenLabs APIキーを設定してください");
  }
  if (!config.voiceId) {
    throw new Error("ElevenLabs Voice IDを設定してください");
  }
  if (!config.modelId) {
    throw new Error("ElevenLabs model_idを設定してください");
  }

  let ElevenLabsClient;
  try {
    ({ ElevenLabsClient } = require("@elevenlabs/elevenlabs-js"));
  } catch {
    throw new Error("ElevenLabs SDKを読み込めません。npm installを実行してください");
  }

  let result;
  try {
    const client = new ElevenLabsClient({ apiKey: config.apiKey });
    const response = await client.textToSpeech.convertWithTimestamps(
      config.voiceId,
      {
        text: cleanText,
        modelId: config.modelId,
        outputFormat: "mp3_44100_128",
      },
      {
        timeoutInSeconds: 240,
      }
    );
    result = response?.data || response;
  } catch (error) {
    if (error?.statusCode === 401 || error?.statusCode === 403) {
      throw new Error("ElevenLabs APIキーを確認してください。認証で失敗しました");
    }
    if (error?.statusCode === 404) {
      throw new Error("ElevenLabs Voice IDを確認してください。指定した声が見つかりません");
    }
    if (error?.statusCode === 422) {
      throw new Error("ElevenLabsの入力形式が正しくありません。文章、voice_id、model_idを確認してください");
    }
    throw new Error("ElevenLabsで音声を生成できませんでした。ネット接続とAPIキーを確認してください");
  }

  if (!result?.audioBase64) {
    throw new Error("ElevenLabsの音声データを保存できませんでした。もう一度試してください");
  }

  const audioPath = voiceAudioPath();
  const timestampsPath = voiceTimestampsPath();
  await fsp.mkdir(INPUT_DIR, { recursive: true });
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.writeFile(audioPath, Buffer.from(result.audioBase64, "base64"));

  const timestamps = {
    provider: "elevenlabs",
    model_id: config.modelId,
    audio_path: toProjectPath(audioPath),
    text: cleanText,
    generated_at: new Date().toISOString(),
    alignment: result.alignment || null,
    normalized_alignment: result.normalizedAlignment || null,
  };
  await fsp.writeFile(timestampsPath, `${JSON.stringify(timestamps, null, 2)}\n`, "utf8");

  return {
    message: "音声を生成しました",
    audio_path: toProjectPath(audioPath),
    timestamps_path: toProjectPath(timestampsPath),
    audio_url: `/media/${toProjectPath(audioPath)}?v=${Date.now()}`,
    character_count: cleanText.length,
    duration: estimateAlignmentDuration(result),
  };
}

async function listExportClips() {
  if (!fs.existsSync(SELECTED_CLIPS_DIR)) {
    return [];
  }
  const entries = await fsp.readdir(SELECTED_CLIPS_DIR, { withFileTypes: true });
  const clips = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isVideo(entry.name)) {
      continue;
    }
    const filePath = path.join(SELECTED_CLIPS_DIR, entry.name);
    const stat = await fsp.stat(filePath);
    clips.push({
      name: entry.name,
      path: toProjectPath(filePath),
      url: `/media/${toProjectPath(filePath)}?v=${stat.mtimeMs}`,
      size: stat.size,
    });
  }
  return clips.sort((a, b) => a.name.localeCompare(b.name, "en"));
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

async function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

function timelineRenderPaths() {
  return {
    adaptScript: path.join(PROJECT_ROOT, "scripts", "adapt_asset_manifest.js"),
    buildScript: path.join(PROJECT_ROOT, "scripts", "build_timeline_roughcut.js"),
    manifestCheck: path.join(OUTPUT_DIR, "asset_manifest_check.json"),
    plan: path.join(OUTPUT_DIR, "rough_cut_plan.json"),
    roughCut: path.join(OUTPUT_DIR, "rough_cut.mp4"),
  };
}

function formatScriptLog(scriptName, result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return output ? `${scriptName}\n${output}` : `${scriptName}\n(no output)`;
}

async function runTimelineScript(scriptPath, options = {}) {
  const scriptName = path.basename(scriptPath);
  if (!fs.existsSync(scriptPath)) {
    const error = new Error(`${scriptName} が見つかりません`);
    error.logs = [`${scriptName}\nmissing: ${toProjectPath(scriptPath)}`];
    throw error;
  }
  try {
    return await execFileAsync(process.execPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 80,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });
  } catch (error) {
    const failed = new Error(`${scriptName} の実行に失敗しました`);
    failed.logs = [
      formatScriptLog(scriptName, {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || "",
      }),
    ];
    throw failed;
  }
}

async function timelineRenderState() {
  const paths = timelineRenderPaths();
  return {
    inProgress: timelineRenderInProgress,
    scripts: {
      adapt_asset_manifest: fs.existsSync(paths.adaptScript),
      build_timeline_roughcut: fs.existsSync(paths.buildScript),
    },
    outputExists: fs.existsSync(paths.roughCut),
    outputUrl: fs.existsSync(paths.roughCut) ? `/media/output/rough_cut.mp4?v=${Date.now()}` : null,
    manifestCheck: await readJsonIfExists(paths.manifestCheck),
    plan: await readJsonIfExists(paths.plan),
  };
}

async function runTimelineRender() {
  const paths = timelineRenderPaths();
  const logs = [];
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });

  try {
    const adaptResult = await runTimelineScript(paths.adaptScript);
    logs.push(formatScriptLog("adapt_asset_manifest.js", adaptResult));

    const buildResult = await runTimelineScript(paths.buildScript, {
      env: { ASSET_MANIFEST_PATH: "output/asset_manifest_for_renderer.json" },
    });
    logs.push(formatScriptLog("build_timeline_roughcut.js", buildResult));
  } catch (error) {
    logs.push(...(error.logs || []));
    const message = error.message || "音声タイムライン生成に失敗しました";
    const details = logs.join("\n\n").trim();
    const failed = new Error(details ? `${message}\n${details}` : message);
    failed.logs = logs;
    throw failed;
  }

  const manifestCheck = await readJsonIfExists(paths.manifestCheck);
  const plan = await readJsonIfExists(paths.plan);
  const outputExists = fs.existsSync(paths.roughCut);
  return {
    ok: Boolean(outputExists && manifestCheck?.ok !== false && plan?.ok !== false),
    outputExists,
    outputUrl: outputExists ? `/media/output/rough_cut.mp4?v=${Date.now()}` : null,
    manifestCheck,
    plan,
    exportClips: await listExportClips(),
    logs,
  };
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
  if (url.pathname === "/api/settings" && request.method === "GET") {
    sendJson(response, 200, { settings: await readSettings() });
    return;
  }
  if (url.pathname === "/api/settings" && request.method === "PUT") {
    try {
      const body = await readRequestBody(request);
      sendJson(response, 200, { settings: await writeSettings(body.settings || body) });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  if (url.pathname === "/api/voice/status" && request.method === "GET") {
    sendJson(response, 200, await voiceStatus());
    return;
  }
  if (url.pathname === "/api/voice/generate" && request.method === "POST") {
    if (voiceInProgress) {
      sendJson(response, 409, { error: "音声生成中です。完了までお待ちください" });
      return;
    }
    voiceInProgress = true;
    try {
      const body = await readRequestBody(request);
      sendJson(response, 200, await generateElevenLabsVoice(body.text));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    } finally {
      voiceInProgress = false;
    }
    return;
  }
  if (url.pathname === "/api/script/merge-timestamps" && request.method === "POST") {
    try {
      sendJson(response, 200, await mergeTimestampsIntoScript());
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  if (url.pathname === "/api/timeline-render-state" && request.method === "GET") {
    sendJson(response, 200, await timelineRenderState());
    return;
  }
  if (url.pathname === "/api/timeline-render" && request.method === "POST") {
    if (timelineRenderInProgress) {
      sendJson(response, 409, { error: "音声タイムライン生成中です。完了までお待ちください" });
      return;
    }
    timelineRenderInProgress = true;
    try {
      sendJson(response, 200, await runTimelineRender());
    } catch (error) {
      sendJson(response, 400, {
        error: error.message || "音声タイムライン生成に失敗しました",
        logs: error.logs || [],
      });
    } finally {
      timelineRenderInProgress = false;
    }
    return;
  }
  if (url.pathname === "/api/asset-catalog" && request.method === "GET") {
    sendJson(response, 200, await withInstallStatus(await fetchAssetCatalog()));
    return;
  }
  if (url.pathname === "/api/assets/install" && request.method === "POST") {
    try {
      const body = await readRequestBody(request);
      sendJson(response, 200, await installAssetPack(String(body.pack_id || "")));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }
  if (url.pathname === "/api/state") {
    sendJson(response, 200, {
      assets: await assetSummary(),
      outputExists: fs.existsSync(path.join(OUTPUT_DIR, "rough_cut.mp4")),
      exportClips: await listExportClips(),
    });
    return;
  }
  if (url.pathname === "/api/export-clips") {
    sendJson(response, 200, { clips: await listExportClips() });
    return;
  }
  if (url.pathname === "/api/assets") {
    sendJson(response, 200, await assetSummary());
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
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
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

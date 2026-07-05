const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "assets", "asset_manifest.json");
const outputManifestPath = path.join(rootDir, "output", "asset_manifest_for_renderer.json");
const checkPath = path.join(rootDir, "output", "asset_manifest_check.json");
const roleNames = ["hook", "problem", "explain", "proof", "cta"];

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

function roleFromPath(assetPath) {
  const parts = String(assetPath || "").split(/[\\/]+/);
  return roleNames.find((role) => parts.includes(role)) || "unknown";
}

function normalizeVideo(pack, video) {
  const role = roleFromPath(video.path);
  const projectPath = path.join("assets", video.path).split(path.sep).join("/");
  const absolutePath = path.join(rootDir, projectPath);
  return {
    pack_id: pack.id,
    pack_version: pack.version,
    install_dir: pack.install_dir,
    role,
    path: projectPath,
    absolute_path: absolutePath,
    duration: Number(video.duration),
    fps: video.fps,
    width: video.width,
    height: video.height,
    aspect_ratio: video.aspect_ratio,
    file_size: video.file_size,
    exists: fs.existsSync(absolutePath),
  };
}

if (!fs.existsSync(sourcePath)) {
  fail("assets/asset_manifest.json が見つかりません。先に素材パックを導入してください。");
}

const source = readJson(sourcePath);
const packs = Array.isArray(source.packs) ? source.packs : [];
const videos = packs.flatMap((pack) =>
  Array.isArray(pack.videos) ? pack.videos.map((video) => normalizeVideo(pack, video)) : []
);
const missing = videos.filter((video) => !video.exists);
const roleCounts = Object.fromEntries(roleNames.map((role) => [role, videos.filter((video) => video.role === role).length]));
const unknownCount = videos.filter((video) => video.role === "unknown").length;

const rendererManifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source: "assets/asset_manifest.json",
  video_count: videos.length,
  roles: roleCounts,
  videos,
};

const check = {
  ok: videos.length === 34 && missing.length === 0 && unknownCount === 0,
  expected_video_count: 34,
  video_count: videos.length,
  missing_count: missing.length,
  unknown_role_count: unknownCount,
  roles: roleCounts,
  output_manifest: "output/asset_manifest_for_renderer.json",
  missing: missing.map((video) => video.path),
};

fs.mkdirSync(path.dirname(outputManifestPath), { recursive: true });
fs.writeFileSync(outputManifestPath, `${JSON.stringify(rendererManifest, null, 2)}\n`, "utf8");
fs.writeFileSync(checkPath, `${JSON.stringify(check, null, 2)}\n`, "utf8");

console.log(`asset manifest source: ${path.relative(rootDir, sourcePath)}`);
console.log(`recognized videos: ${videos.length}`);
console.log(`role counts: ${JSON.stringify(roleCounts)}`);
console.log(`created: ${path.relative(rootDir, outputManifestPath)}`);
console.log(`created: ${path.relative(rootDir, checkPath)}`);
if (!check.ok) {
  fail("asset manifest check failed");
}

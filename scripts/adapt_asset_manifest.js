#!/usr/bin/env node
"use strict";

/**
 * Converts PicoEdit's installed-pack manifest into the flat manifest consumed by
 * scripts/build_timeline_roughcut.js. The original asset_manifest.json is never
 * changed.
 *
 * Usage:
 *   node scripts/adapt_asset_manifest.js
 *
 * Optional environment variables:
 *   SOURCE_ASSET_MANIFEST=assets/asset_manifest.json
 *   ASSET_ROOT=assets
 *   OUTPUT_ASSET_MANIFEST=output/asset_manifest_for_renderer.json
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv"]);

function fromProjectPath(value) {
  const resolved = path.resolve(ROOT, value);
  const root = path.resolve(ROOT);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Project path is outside PicoEdit: ${value}`);
  }
  return resolved;
}

function projectPath(value) {
  return path.relative(ROOT, value).split(path.sep).join("/");
}

function firstExisting(candidates, label) {
  for (const candidate of candidates.filter(Boolean)) {
    const resolved = fromProjectPath(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  throw new Error(`${label} was not found. Checked:\n${candidates.filter(Boolean).join("\n")}`);
}

function roleFromPackPath(packPath) {
  const parts = String(packPath).split("/").filter(Boolean);
  // pack path = <install_dir>/<role>/<file>
  return parts.length >= 3 ? parts[1] : null;
}

async function main() {
  const source = firstExisting(
    [
      process.env.SOURCE_ASSET_MANIFEST,
      "assets/asset_manifest.json",
      "asset_manifest.json",
      "output/asset_manifest.json",
      "config/asset_manifest.json",
    ],
    "asset_manifest.json"
  );
  const assetRoot = String(process.env.ASSET_ROOT || "assets").replace(/[\\/]+$/, "");
  const destination = fromProjectPath(
    process.env.OUTPUT_ASSET_MANIFEST || "output/asset_manifest_for_renderer.json"
  );

  const sourceData = JSON.parse(await fsp.readFile(source, "utf8"));
  if (!Array.isArray(sourceData?.packs)) {
    throw new Error("Expected PicoEdit pack manifest format: { packs: [{ install_dir, videos: [] }] }.");
  }

  const assets = [];
  const skipped = [];
  for (const pack of sourceData.packs) {
    const installDir = String(pack.install_dir || pack.id || "").trim();
    const videos = Array.isArray(pack.videos) ? pack.videos : [];
    if (!installDir || !videos.length) {
      skipped.push({ pack: pack.id || null, reason: "install_dir or videos missing" });
      continue;
    }

    for (const video of videos) {
      const packPath = String(video?.path || "").replaceAll("\\", "/").replace(/^\/+/, "");
      if (!packPath || !VIDEO_EXTENSIONS.has(path.extname(packPath).toLowerCase())) {
        skipped.push({ pack: pack.id || installDir, path: video?.path || null, reason: "invalid video path" });
        continue;
      }

      const expectedPrefix = `${installDir}/`;
      const normalizedPackPath = packPath.startsWith(expectedPrefix)
        ? packPath
        : `${installDir}/${packPath}`;
      const role = roleFromPackPath(normalizedPackPath);
      const localPath = `${assetRoot}/${normalizedPackPath}`;

      assets.push({
        id: `${pack.id || installDir}:${normalizedPackPath}`,
        path: localPath,
        role,
        tags: [role, pack.id, pack.name].filter(Boolean),
        source_duration: video.duration ?? null,
        source_fps: video.fps ?? null,
        source_size: video.width && video.height ? `${video.width}x${video.height}` : null,
        pack_id: pack.id || installDir,
      });
    }
  }

  if (!assets.length) {
    throw new Error("No supported videos were produced from the pack manifest.");
  }

  const result = {
    generated_by: "scripts/adapt_asset_manifest.js",
    generated_at: new Date().toISOString(),
    source_manifest: projectPath(source),
    asset_root: assetRoot,
    assets,
    skipped,
  };

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const roleCounts = assets.reduce((acc, asset) => {
    acc[asset.role] = (acc[asset.role] || 0) + 1;
    return acc;
  }, {});

  console.log(`Created ${projectPath(destination)}`);
  console.log(`Assets: ${assets.length}`);
  console.log(`Roles: ${JSON.stringify(roleCounts)}`);
  if (skipped.length) console.log(`Skipped: ${skipped.length}`);
}

main().catch((error) => {
  console.error("Asset manifest adaptation failed.");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

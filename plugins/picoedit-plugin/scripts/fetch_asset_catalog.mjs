#!/usr/bin/env node
import { request } from "node:https";

const CATALOG_URL = "https://pub-78d5d49156194b43ae62cc67bd6faf88.r2.dev/asset_catalog.json";
const CATALOG_HOST = "pub-78d5d49156194b43ae62cc67bd6faf88.r2.dev";
const CATALOG_PATH = "/asset_catalog.json";
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;

const CONNECT_ERROR = "素材カタログに接続できません。ネット接続と配布URLを確認してください";
const FORMAT_ERROR = "素材カタログの形式が正しくありません。管理者に連絡してください";
const EMPTY_MESSAGE = "利用可能な素材パックはありません";

function validateUrl(value) {
  const url = new URL(String(value || ""));
  if (
    url.protocol !== "https:" ||
    url.hostname !== CATALOG_HOST ||
    url.pathname !== CATALOG_PATH ||
    url.search ||
    url.hash ||
    url.href !== CATALOG_URL
  ) {
    throw new Error("このバージョンでは指定された素材カタログURLだけを利用できます。");
  }
  return url;
}

function fetchCatalog(catalogUrl) {
  const url = validateUrl(catalogUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        headers: { accept: "application/json" },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(CONNECT_ERROR));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_BYTES) {
            req.destroy(new Error(FORMAT_ERROR));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const catalog = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || !Array.isArray(catalog.packs)) {
              throw new Error(FORMAT_ERROR);
            }
            resolve(catalog);
          } catch (error) {
            reject(error.message === FORMAT_ERROR ? error : new Error(FORMAT_ERROR));
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error(CONNECT_ERROR)));
    req.on("error", (error) => {
      reject(error.message === FORMAT_ERROR ? error : new Error(CONNECT_ERROR));
    });
    req.end();
  });
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const catalog = await fetchCatalog(CATALOG_URL);
  const packs = catalog.packs;
  const message = packs.length ? `${packs.length}件の素材パックがあります` : EMPTY_MESSAGE;

  if (hasFlag("--json")) {
    console.log(JSON.stringify({ ...catalog, message }, null, 2));
    return;
  }

  if (!packs.length) {
    console.log(EMPTY_MESSAGE);
    return;
  }

  console.log(message);
  for (const pack of packs) {
    const packId = String(pack.id || "-");
    const name = String(pack.name || packId);
    const version = String(pack.version || "-");
    console.log(`- ${name} (${packId}, ${version})`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});

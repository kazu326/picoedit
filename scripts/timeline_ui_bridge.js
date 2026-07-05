#!/usr/bin/env node
"use strict";

/**
 * Local-only bridge for the timeline-driven rough-cut workflow.
 *
 * The existing PicoEdit server intentionally remains unchanged. This bridge
 * exposes only two fixed actions to the browser UI:
 *   GET  /api/status
 *   POST /api/render
 *
 * It never accepts a script path, shell command, asset path, or API key from
 * the browser. It can only run the two project-owned scripts below.
 */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const HOST = "127.0.0.1";
const PORT = Number(process.env.TIMELINE_UI_PORT || 8766);
const WEB_PORT = Number(process.env.PICOEDIT_WEB_PORT || 8765);
const ADAPT_SCRIPT = path.join(ROOT, "scripts", "adapt_asset_manifest.js");
const RENDER_SCRIPT = path.join(ROOT, "scripts", "build_timeline_roughcut.js");
const ADAPTED_MANIFEST = "output/asset_manifest_for_renderer.json";
const PLAN_PATH = path.join(OUTPUT_DIR, "rough_cut_plan.json");
const MANIFEST_CHECK_PATH = path.join(OUTPUT_DIR, "asset_manifest_check.json");
const OUTPUT_VIDEO_PATH = path.join(OUTPUT_DIR, "rough_cut.mp4");

let renderInProgress = false;

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(value, null, 2));
}

async function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    return { _read_error: error.message };
  }
}

function outputUrl() {
  return `http://${HOST}:${WEB_PORT}/media/output/rough_cut.mp4?v=${Date.now()}`;
}

async function getStatus() {
  const [plan, manifestCheck] = await Promise.all([
    readJsonIfExists(PLAN_PATH),
    readJsonIfExists(MANIFEST_CHECK_PATH),
  ]);

  return {
    ok: true,
    bridge_port: PORT,
    render_in_progress: renderInProgress,
    scripts_ready: fs.existsSync(ADAPT_SCRIPT) && fs.existsSync(RENDER_SCRIPT),
    output_exists: fs.existsSync(OUTPUT_VIDEO_PATH),
    output_url: fs.existsSync(OUTPUT_VIDEO_PATH) ? outputUrl() : null,
    plan,
    manifest_check: manifestCheck,
  };
}

async function runProjectScript(scriptPath, env = {}) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Required script is missing: ${path.relative(ROOT, scriptPath)}`);
  }

  try {
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024 * 80,
    });
    return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
    throw new Error(detail || `Failed to run ${path.relative(ROOT, scriptPath)}`);
  }
}

async function renderTimelineRoughCut() {
  if (renderInProgress) {
    const error = new Error("音声タイムラインのラフカット生成はすでに実行中です。");
    error.statusCode = 409;
    throw error;
  }

  renderInProgress = true;
  try {
    const adaptLog = await runProjectScript(ADAPT_SCRIPT);
    const renderLog = await runProjectScript(RENDER_SCRIPT, {
      ASSET_MANIFEST_PATH: ADAPTED_MANIFEST,
    });
    const status = await getStatus();
    if (!status.output_exists) {
      throw new Error("レンダー処理は完了しましたが output/rough_cut.mp4 が見つかりません。");
    }
    return {
      ...status,
      logs: [adaptLog, renderLog].filter(Boolean),
    };
  } finally {
    renderInProgress = false;
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (url.pathname === "/api/status" && request.method === "GET") {
      sendJson(response, 200, await getStatus());
      return;
    }
    if (url.pathname === "/api/render" && request.method === "POST") {
      sendJson(response, 200, await renderTimelineRoughCut());
      return;
    }
    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`picoedit timeline UI bridge running at http://${HOST}:${PORT}/`);
});

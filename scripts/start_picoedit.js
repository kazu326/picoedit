#!/usr/bin/env node
"use strict";

/** Starts the existing PicoEdit app and the local timeline-render bridge together. */

const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const webPort = String(process.env.PORT || 8765);
const bridgePort = String(process.env.TIMELINE_UI_PORT || 8766);

const children = [
  spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: webPort },
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, [path.join(ROOT, "scripts", "timeline_ui_bridge.js")], {
    cwd: ROOT,
    env: { ...process.env, PICOEDIT_WEB_PORT: webPort, TIMELINE_UI_PORT: bridgePort },
    stdio: "inherit",
    windowsHide: true,
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`picoedit child process exited (${signal || code || 0}).`);
    stop(code || 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

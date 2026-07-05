const state = {
  assets: null,
  outputExists: false,
  exportClips: [],
  voice: null,
  timelineRenderState: null,
  assetCatalog: null,
  installingPackId: null,
  exportDirectoryHandle: null,
  exportDirectoryName: "",
};

const elements = {
  projectStatus: document.querySelector("#projectStatus"),
  reloadButton: document.querySelector("#reloadButton"),
  timelineRenderButton: document.querySelector("#timelineRenderButton"),
  exportFolderButton: document.querySelector("#exportFolderButton"),
  exportButton: document.querySelector("#exportButton"),
  previewVideo: document.querySelector("#previewVideo"),
  emptyPreview: document.querySelector("#emptyPreview"),
  outputMeta: document.querySelector("#outputMeta"),
  singleVideoButton: document.querySelector("#singleVideoButton"),
  voiceStatus: document.querySelector("#voiceStatus"),
  voiceText: document.querySelector("#voiceText"),
  voiceGenerateButton: document.querySelector("#voiceGenerateButton"),
  mergeTimestampsButton: document.querySelector("#mergeTimestampsButton"),
  voiceMeta: document.querySelector("#voiceMeta"),
  voiceAudio: document.querySelector("#voiceAudio"),
  timelineMeta: document.querySelector("#timelineMeta"),
  timelineRows: document.querySelector("#timelineRows"),
  assetMeta: document.querySelector("#assetMeta"),
  assetFolders: document.querySelector("#assetFolders"),
  packMeta: document.querySelector("#packMeta"),
  packList: document.querySelector("#packList"),
  logOutput: document.querySelector("#logOutput"),
  clearLogButton: document.querySelector("#clearLogButton"),
};

function log(message, type = "info") {
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  const prefix = type === "warn" ? "WARN" : type === "error" ? "ERR " : "INFO";
  elements.logOutput.textContent += `[${time}] ${prefix} ${message}\n`;
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.logs = data.logs || [];
    throw error;
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileNameFromPath(assetPath) {
  return String(assetPath || "").split("/").pop() || "-";
}

function renderPreview(outputUrl) {
  const frame = elements.previewVideo.closest(".preview-frame");
  if (outputUrl || state.outputExists) {
    const url = outputUrl || `/media/output/rough_cut.mp4?v=${Date.now()}`;
    elements.previewVideo.src = url;
    frame.classList.add("has-video");
    elements.singleVideoButton.href = url;
    elements.singleVideoButton.setAttribute("aria-disabled", "false");
    elements.singleVideoButton.tabIndex = 0;
  } else {
    elements.previewVideo.removeAttribute("src");
    frame.classList.remove("has-video");
    elements.singleVideoButton.href = "/media/output/rough_cut.mp4";
    elements.singleVideoButton.setAttribute("aria-disabled", "true");
    elements.singleVideoButton.tabIndex = -1;
  }
  renderExportControls();
}

function renderExportControls() {
  const clipCount = state.exportClips?.length || 0;
  elements.exportButton.disabled = clipCount === 0;
  elements.exportButton.textContent = clipCount ? `書き出し (${clipCount})` : "書き出し";
  elements.exportFolderButton.textContent = state.exportDirectoryName
    ? `書き出し先: ${state.exportDirectoryName}`
    : "書き出し先";
}

function renderVoice() {
  const voice = state.voice || {};
  if (!voice.api_key_configured) {
    elements.voiceStatus.textContent = "APIキー未設定";
  } else if (!voice.voice_id_configured) {
    elements.voiceStatus.textContent = "Voice ID未設定";
  } else {
    elements.voiceStatus.textContent = "設定済み";
  }

  if (voice.audio_url) {
    elements.voiceAudio.src = voice.audio_url;
    elements.voiceAudio.hidden = false;
    elements.voiceMeta.textContent = `${voice.audio_path} / ${voice.timestamps_path}`;
  } else {
    elements.voiceAudio.removeAttribute("src");
    elements.voiceAudio.hidden = true;
    elements.voiceMeta.textContent = voice.configured ? "音声はまだありません" : "ElevenLabs APIキーを設定してください";
  }
}

function renderTimeline() {
  const timelineRender = state.timelineRenderState || {};
  const plan = timelineRender.plan || {};
  const check = timelineRender.manifestCheck || {};
  const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
  elements.timelineMeta.textContent = assignments.length
    ? `${assignments.length} segments / ${Number(plan.rough_cut_duration || 0).toFixed(2)}s`
    : "-";
  elements.outputMeta.textContent = timelineRender.outputExists
    ? `${Number(plan.rough_cut_duration || 0).toFixed(2)}s / 1080x1920`
    : "-";
  elements.timelineRows.innerHTML = "";

  if (!assignments.length) {
    elements.timelineRows.innerHTML = `<div class="timeline-row"><p>output/timeline_with_captions.json を基準に生成します。</p></div>`;
    return;
  }

  const roles = check.roles || {};
  const summary = document.createElement("article");
  summary.className = "timeline-row timeline-summary";
  summary.innerHTML = `
    <header>
      <span>音声タイムライン生成</span>
      <span>${escapeHtml(String(plan.ok ? "OK" : "確認中"))}</span>
    </header>
    <p>素材 ${Number(check.video_count || plan.recognized_video_count || 0)}本</p>
    <p>hook ${Number(roles.hook || 0)} / problem ${Number(roles.problem || 0)} / explain ${Number(roles.explain || 0)} / proof ${Number(roles.proof || 0)} / cta ${Number(roles.cta || 0)}</p>
    <p>missing ${Number(check.missing_count || 0)}</p>
  `;
  elements.timelineRows.appendChild(summary);

  for (const assignment of assignments) {
    const row = document.createElement("article");
    row.className = "timeline-row";
    row.innerHTML = `
      <header>
        <span>${escapeHtml(assignment.segment_id)} / ${escapeHtml(assignment.role)}</span>
        <span>${Number(assignment.start).toFixed(2)}-${Number(assignment.end).toFixed(2)}s</span>
      </header>
      <p>素材: ${escapeHtml(fileNameFromPath(assignment.asset_path))}</p>
      <p>${escapeHtml(assignment.asset_path)}</p>
      <p>処理: ${escapeHtml(assignment.render_mode)} / ${Number(assignment.duration_sec).toFixed(2)}s</p>
    `;
    elements.timelineRows.appendChild(row);
  }
}

function renderAssets() {
  const folders = state.assets?.folders || [];
  elements.assetMeta.textContent = `${state.assets?.count || 0} files`;
  elements.assetFolders.innerHTML = "";

  for (const group of folders) {
    const node = document.createElement("article");
    node.className = "asset-folder";
    const files = group.files.map((file) => `<li>${escapeHtml(file.name)}</li>`).join("");
    node.innerHTML = `
      <header>
        <span>${escapeHtml(group.folder)}</span>
        <span>${group.count}</span>
      </header>
      <ul>${files}</ul>
    `;
    elements.assetFolders.appendChild(node);
  }
}

function renderAssetPacks() {
  const packs = state.assetCatalog?.packs || [];
  elements.packMeta.textContent = packs.length ? `${packs.length} packs` : "0 packs";
  elements.packList.innerHTML = "";

  if (!packs.length) {
    elements.packList.innerHTML = `<article class="pack-card"><p>利用可能な素材パックはありません。</p></article>`;
    return;
  }

  for (const pack of packs) {
    const card = document.createElement("article");
    card.className = "pack-card";
    const isInstalling = state.installingPackId === pack.id;
    const installed = Boolean(pack.installed);
    card.innerHTML = `
      <div>
        <header>
          <strong>${escapeHtml(pack.name || pack.id)}</strong>
          <span>v${escapeHtml(pack.version || "-")}</span>
        </header>
        <p>${escapeHtml(pack.description || "")}</p>
        <small>${installed ? "導入済み" : "未導入"}</small>
      </div>
      <button type="button" data-action="install-pack" data-pack-id="${escapeHtml(pack.id)}" ${installed || isInstalling ? "disabled" : ""}>
        ${installed ? "導入済み" : isInstalling ? "導入中" : "インストール"}
      </button>
    `;
    elements.packList.appendChild(card);
  }
}

function renderAll() {
  renderVoice();
  renderTimeline();
  renderAssets();
  renderAssetPacks();
  renderPreview();
  elements.projectStatus.textContent = `${state.assets?.count || 0} assets`;
}

async function loadState() {
  const data = await api("/api/state");
  state.assets = data.assets;
  state.outputExists = data.outputExists;
  state.exportClips = data.exportClips || [];
  state.voice = await api("/api/voice/status");
  state.timelineRenderState = await api("/api/timeline-render-state");
  state.assetCatalog = await api("/api/asset-catalog");
  renderAll();
  log("loaded project state");
}

async function installAssetPack(packId) {
  state.installingPackId = packId;
  renderAssetPacks();
  log(`asset pack install started: ${packId}`);
  try {
    const result = await api("/api/assets/install", {
      method: "POST",
      body: JSON.stringify({ pack_id: packId }),
    });
    log(result.message);
    const stateData = await api("/api/state");
    state.assets = stateData.assets;
    state.outputExists = stateData.outputExists;
    state.exportClips = stateData.exportClips || [];
    state.assetCatalog = await api("/api/asset-catalog");
    renderAll();
  } catch (error) {
    log(`${error.message} 次の一手: ネット接続を確認し、もう一度インストールしてください。`, "error");
  } finally {
    state.installingPackId = null;
    renderAssetPacks();
  }
}

async function chooseExportFolder() {
  if (!window.showDirectoryPicker) {
    throw new Error("このブラウザでは書き出し先フォルダを選択できません。ChromeまたはEdgeで開いてください。");
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  state.exportDirectoryHandle = handle;
  state.exportDirectoryName = handle.name || "";
  renderExportControls();
  log(`書き出し先を選択しました: ${state.exportDirectoryName || "選択済みフォルダ"}`);
}

async function ensureExportFolderPermission(handle) {
  if (!handle) return;
  if (typeof handle.queryPermission === "function") {
    const current = await handle.queryPermission({ mode: "readwrite" });
    if (current === "granted") return;
  }
  if (typeof handle.requestPermission === "function") {
    const requested = await handle.requestPermission({ mode: "readwrite" });
    if (requested !== "granted") {
      throw new Error("書き出し先フォルダへの保存が許可されませんでした。もう一度フォルダを選択してください。");
    }
  }
}

async function exportSelectedClips() {
  if (!state.exportClips?.length) {
    log("書き出しできる分割素材がありません。先に生成してください。", "warn");
    return;
  }
  if (!state.exportDirectoryHandle) {
    await chooseExportFolder();
  }
  await ensureExportFolderPermission(state.exportDirectoryHandle);
  elements.exportButton.disabled = true;
  elements.exportButton.textContent = "書き出し中";
  try {
    for (const clip of state.exportClips) {
      const response = await fetch(clip.url);
      if (!response.ok) {
        throw new Error("分割素材を読み込めません。もう一度生成してください。");
      }
      const fileHandle = await state.exportDirectoryHandle.getFileHandle(clip.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(await response.blob());
      await writable.close();
    }
    log(`分割素材を書き出しました: ${state.exportClips.length}本`);
  } finally {
    renderExportControls();
  }
}

async function generateVoice() {
  const text = elements.voiceText.value.trim();
  elements.voiceGenerateButton.disabled = true;
  elements.voiceGenerateButton.textContent = "生成中";
  elements.voiceMeta.textContent = "音声生成中";
  try {
    const result = await api("/api/voice/generate", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    state.voice = {
      ...(state.voice || {}),
      configured: true,
      api_key_configured: true,
      voice_id_configured: true,
      audio_exists: true,
      audio_path: result.audio_path,
      timestamps_path: result.timestamps_path,
      audio_url: result.audio_url,
    };
    renderVoice();
    log(`${result.message}: ${result.audio_path}`);
  } catch (error) {
    elements.voiceMeta.textContent = error.message;
    log(error.message, "error");
  } finally {
    elements.voiceGenerateButton.disabled = false;
    elements.voiceGenerateButton.textContent = "音声生成";
  }
}

async function mergeTimestamps() {
  elements.mergeTimestampsButton.disabled = true;
  elements.mergeTimestampsButton.textContent = "結合中";
  elements.voiceMeta.textContent = "timestamps結合中";
  try {
    const result = await api("/api/script/merge-timestamps", {
      method: "POST",
      body: JSON.stringify({}),
    });
    elements.voiceMeta.textContent = `${result.script_path} / ${result.timeline_path}`;
    log(`${result.message}: ${result.segment_count} segments`);
  } catch (error) {
    elements.voiceMeta.textContent = error.message;
    log(error.message, "error");
  } finally {
    elements.mergeTimestampsButton.disabled = false;
    elements.mergeTimestampsButton.textContent = "timestamps結合";
  }
}

async function renderTimelineRoughCut() {
  setBusy(true);
  log("音声タイムライン生成を開始");
  log("素材台帳を変換");
  try {
    const data = await api("/api/timeline-render", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.timelineRenderState = {
      inProgress: false,
      scripts: { adapt_asset_manifest: true, build_timeline_roughcut: true },
      outputExists: data.outputExists,
      outputUrl: data.outputUrl,
      manifestCheck: data.manifestCheck,
      plan: data.plan,
    };
    state.outputExists = data.outputExists;
    state.exportClips = data.exportClips || [];
    log(`${data.manifestCheck?.video_count || data.plan?.recognized_video_count || 0}素材を認識`);
    log(`${data.plan?.segment_count || 0} segmentsへ素材を割当`);
    log("rough_cut.mp4を生成");
    renderTimeline();
    renderPreview(data.outputUrl);
    log("完了");
  } catch (error) {
    for (const scriptLog of error.logs || []) {
      log(scriptLog, "error");
    }
    log(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  elements.timelineRenderButton.disabled = isBusy;
  elements.reloadButton.disabled = isBusy;
  elements.voiceGenerateButton.disabled = isBusy;
  elements.mergeTimestampsButton.disabled = isBusy;
  elements.exportFolderButton.disabled = isBusy;
  elements.exportButton.disabled = isBusy || !state.exportClips?.length;
  elements.timelineRenderButton.textContent = isBusy ? "生成中" : "音声タイムライン生成";
  elements.exportButton.textContent = isBusy ? "書き出し" : (state.exportClips?.length ? `書き出し (${state.exportClips.length})` : "書き出し");
  elements.projectStatus.textContent = isBusy ? "生成中" : `${state.assets?.count || 0} assets`;
}

elements.reloadButton.addEventListener("click", () => {
  loadState().catch((error) => log(error.message, "error"));
});

elements.timelineRenderButton.addEventListener("click", renderTimelineRoughCut);

elements.voiceGenerateButton.addEventListener("click", () => {
  generateVoice().catch((error) => log(error.message, "error"));
});

elements.mergeTimestampsButton.addEventListener("click", () => {
  mergeTimestamps().catch((error) => log(error.message, "error"));
});

elements.exportFolderButton.addEventListener("click", () => {
  chooseExportFolder().catch((error) => log(error.message, "error"));
});

elements.exportButton.addEventListener("click", () => {
  exportSelectedClips().catch((error) => log(error.message, "error"));
});

elements.packList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='install-pack']");
  if (!button || button.disabled) {
    return;
  }
  installAssetPack(button.dataset.packId).catch((error) => log(error.message, "error"));
});

elements.clearLogButton.addEventListener("click", () => {
  elements.logOutput.textContent = "";
});

loadState().catch((error) => {
  elements.projectStatus.textContent = "読み込み失敗";
  log(error.message, "error");
});

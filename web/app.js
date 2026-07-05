const state = {
  templates: [],
  templateName: "ai_prompt_30s.json",
  template: null,
  assets: null,
  timeline: null,
  outputExists: false,
  exportClips: [],
  voice: null,
  slotSelections: {},
  assetCatalog: null,
  installingPackId: null,
  exportDirectoryHandle: null,
  exportDirectoryName: "",
};

const elements = {
  projectStatus: document.querySelector("#projectStatus"),
  templateSelect: document.querySelector("#templateSelect"),
  importJsonButton: document.querySelector("#importJsonButton"),
  jsonFileInput: document.querySelector("#jsonFileInput"),
  reloadButton: document.querySelector("#reloadButton"),
  saveButton: document.querySelector("#saveButton"),
  renderButton: document.querySelector("#renderButton"),
  exportFolderButton: document.querySelector("#exportFolderButton"),
  exportButton: document.querySelector("#exportButton"),
  templateId: document.querySelector("#templateId"),
  outputSize: document.querySelector("#outputSize"),
  fps: document.querySelector("#fps"),
  slotRows: document.querySelector("#slotRows"),
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
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function folderOptions(selectedFolder) {
  const folders = state.assets?.folders || [];
  return folders
    .map(({ folder, count }) => {
      const selected = folder === selectedFolder ? "selected" : "";
      return `<option value="${escapeHtml(folder)}" ${selected}>${escapeHtml(folder)} (${count})</option>`;
    })
    .join("");
}

function allAssets() {
  return (state.assets?.folders || []).flatMap((group) => group.files || []);
}

function findAsset(assetPath) {
  return allAssets().find((asset) => asset.path === assetPath) || null;
}

function assetsForFolder(folder) {
  return allAssets().filter((asset) => asset.folder === folder);
}

function assetOptions(selectedPath, folder) {
  const folderAssets = assetsForFolder(folder);
  const selectedAsset = findAsset(selectedPath);
  const candidates =
    selectedAsset && !folderAssets.some((asset) => asset.path === selectedAsset.path)
      ? [selectedAsset, ...folderAssets]
      : folderAssets;

  return candidates
    .map((asset) => {
      const selected = asset.path === selectedPath ? "selected" : "";
      return `<option value="${escapeHtml(asset.path)}" ${selected}>${escapeHtml(asset.name)}</option>`;
    })
    .join("");
}

function fileNameFromPath(assetPath) {
  return String(assetPath || "").split("/").pop() || "-";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readTemplateFromForm() {
  const rows = [...elements.slotRows.querySelectorAll("tr")];
  return {
    template_id: elements.templateId.value.trim(),
    output_size: elements.outputSize.value.trim(),
    fps: Number(elements.fps.value),
    slots: rows.map((row) => ({
      slot_id: row.dataset.slotId,
      label: row.querySelector("[data-field='label']").value,
      folder: row.querySelector("[data-field='folder']").value,
      target_duration: Number(row.querySelector("[data-field='target_duration']").value),
    })),
  };
}

function readAssetSelectionsFromForm() {
  const selections = {};
  for (const row of elements.slotRows.querySelectorAll("tr")) {
    const assetPath = row.querySelector("[data-field='asset']")?.value;
    if (assetPath) {
      selections[row.dataset.slotId] = assetPath;
    }
  }
  return selections;
}

function updateSlotSelectionView(row, assetPath) {
  const asset = findAsset(assetPath);
  const video = row.querySelector("[data-role='slot-preview']");
  const name = row.querySelector("[data-role='asset-name']");
  const path = row.querySelector("[data-role='asset-path']");

  name.textContent = asset?.name || fileNameFromPath(assetPath);
  path.textContent = assetPath || "-";
  if (assetPath) {
    video.src = `/media/${assetPath}`;
    video.load();
  } else {
    video.removeAttribute("src");
  }
}

function setRowAsset(row, slotId, assetPath) {
  const picker = row.querySelector("[data-field='asset']");
  state.slotSelections[slotId] = assetPath;
  picker.value = assetPath;
  updateSlotSelectionView(row, assetPath);
}

function renderTemplate() {
  const template = state.template;
  elements.templateId.value = template?.template_id || "";
  elements.outputSize.value = template?.output_size || "";
  elements.fps.value = template?.fps || 30;
  elements.slotRows.innerHTML = "";

  for (const slot of template?.slots || []) {
    const selectedAsset = state.slotSelections[slot.slot_id] || "";
    const row = document.createElement("tr");
    row.dataset.slotId = slot.slot_id;
    row.innerHTML = `
      <td class="slot-id" data-label="slot">${escapeHtml(slot.slot_id)}</td>
      <td data-label="label"><input data-field="label" type="text" value="${escapeHtml(slot.label)}"></td>
      <td data-label="folder"><select data-field="folder">${folderOptions(slot.folder)}</select></td>
      <td data-label="sec"><input data-field="target_duration" type="number" min="0.1" step="0.1" value="${slot.target_duration}"></td>
      <td class="asset-cell" data-label="selected asset">
        <strong data-role="asset-name">${escapeHtml(fileNameFromPath(selectedAsset))}</strong>
        <p data-role="asset-path">${escapeHtml(selectedAsset || "-")}</p>
      </td>
      <td data-label="preview">
        <video class="slot-preview-video" data-role="slot-preview" muted controls preload="metadata"></video>
      </td>
      <td class="asset-actions" data-label="change">
        <button type="button" data-action="change-asset">素材を変更</button>
        <select class="asset-picker" data-field="asset" hidden>${assetOptions(selectedAsset, slot.folder)}</select>
      </td>
    `;
    elements.slotRows.appendChild(row);
    const folderSelect = row.querySelector("[data-field='folder']");
    const picker = row.querySelector("[data-field='asset']");
    const changeButton = row.querySelector("[data-action='change-asset']");
    picker.addEventListener("change", () => {
      setRowAsset(row, slot.slot_id, picker.value);
      log(`${slot.slot_id} asset changed to ${fileNameFromPath(picker.value)}`);
    });
    folderSelect.addEventListener("change", () => {
      const folderAssets = assetsForFolder(folderSelect.value);
      picker.innerHTML = assetOptions(folderAssets[0]?.path || "", folderSelect.value);
      if (folderAssets[0]) {
        setRowAsset(row, slot.slot_id, folderAssets[0].path);
        log(`${slot.slot_id} folder changed to ${folderSelect.value}`);
      } else {
        setRowAsset(row, slot.slot_id, "");
        log(`${slot.slot_id} folder has no video assets`, "warn");
      }
    });
    changeButton.addEventListener("click", () => {
      picker.hidden = !picker.hidden;
      if (!picker.hidden) {
        picker.focus();
      }
    });
    updateSlotSelectionView(row, selectedAsset);
  }
}

function renderTemplates() {
  elements.templateSelect.innerHTML = state.templates
    .map((name) => {
      const selected = name === state.templateName ? "selected" : "";
      return `<option value="${escapeHtml(name)}" ${selected}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function renderPreview(outputUrl) {
  const frame = elements.previewVideo.closest(".preview-frame");
  if (outputUrl || state.outputExists) {
    elements.previewVideo.src = outputUrl || `/media/output/rough_cut.mp4?v=${Date.now()}`;
    frame.classList.add("has-video");
    elements.singleVideoButton.href = outputUrl || `/media/output/rough_cut.mp4?v=${Date.now()}`;
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
  const segments = state.timeline?.segments || [];
  const total = segments.length ? segments[segments.length - 1].end : 0;
  elements.timelineMeta.textContent = segments.length ? `${segments.length} slots / ${total.toFixed(1)}s` : "-";
  elements.outputMeta.textContent = state.outputExists ? `${total.toFixed(1)}s / 1080x1920` : "-";
  elements.timelineRows.innerHTML = "";

  if (!segments.length) {
    elements.timelineRows.innerHTML = `<div class="timeline-row"><p>output/timeline.json</p></div>`;
    return;
  }

  for (const segment of segments) {
    const row = document.createElement("article");
    row.className = "timeline-row";
    row.innerHTML = `
      <header>
        <span>${escapeHtml(segment.slot_id)} / ${escapeHtml(segment.label)}</span>
        <span>${segment.start.toFixed(1)}-${segment.end.toFixed(1)}s</span>
      </header>
      <p>${escapeHtml(segment.asset)}</p>
      <p>speed ${Number(segment.speed).toFixed(3)}x</p>
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
    const files = group.files
      .map((file) => `<li>${escapeHtml(file.name)}</li>`)
      .join("");
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
  renderTemplates();
  renderTemplate();
  renderVoice();
  renderTimeline();
  renderAssets();
  renderAssetPacks();
  renderPreview();
  elements.projectStatus.textContent = `${state.templateName} / ${state.assets?.count || 0} assets`;
}

async function loadTemplate(name = state.templateName) {
  const data = await api(`/api/template?name=${encodeURIComponent(name)}`);
  state.templateName = data.name;
  state.template = data.template;
}

async function loadSlotSelections() {
  if (!state.template) {
    state.slotSelections = {};
    return;
  }
  const data = await api("/api/slot-selection", {
    method: "POST",
    body: JSON.stringify({ template: state.template }),
  });
  state.slotSelections = Object.fromEntries(
    (data.selections || []).map((selection) => [selection.slot_id, selection.asset])
  );
  for (const warning of data.warnings || []) {
    log(warning, "warn");
  }
}

async function loadState() {
  const data = await api("/api/state");
  state.templates = data.templates;
  state.assets = data.assets;
  state.timeline = data.timeline;
  state.outputExists = data.outputExists;
  state.exportClips = data.exportClips || [];
  state.voice = await api("/api/voice/status");
  state.assetCatalog = await api("/api/asset-catalog");
  if (!state.templates.includes(state.templateName)) {
    state.templateName = state.templates[0] || state.templateName;
  }
  await loadTemplate(state.templateName);
  await loadSlotSelections();
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
    state.timeline = stateData.timeline;
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

function validateImportedTemplate(template) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("JSONの形式が正しくありません。テンプレートJSONを選んでください。");
  }
  for (const key of ["template_id", "output_size", "fps", "slots"]) {
    if (!(key in template)) {
      throw new Error(`JSONに ${key} がありません。テンプレートJSONを選んでください。`);
    }
  }
  if (!Array.isArray(template.slots) || template.slots.length === 0) {
    throw new Error("JSONにスロットがありません。テンプレートJSONを選んでください。");
  }
}

async function importTemplateJson(file) {
  const text = await file.text();
  let template;
  try {
    template = JSON.parse(text);
  } catch {
    throw new Error("JSONを読み込めません。ファイルの形式を確認してください。");
  }
  validateImportedTemplate(template);
  state.templateName = file.name.toLowerCase().endsWith(".json") ? file.name : `${file.name}.json`;
  state.template = template;
  if (!state.templates.includes(state.templateName)) {
    state.templates = [state.templateName, ...state.templates];
  }
  await loadSlotSelections();
  renderAll();
  log(`JSONを読み込みました: ${state.templateName}`);
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
  if (!handle) {
    return;
  }
  if (typeof handle.queryPermission === "function") {
    const current = await handle.queryPermission({ mode: "readwrite" });
    if (current === "granted") {
      return;
    }
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
    const timelineData = await api("/api/timeline");
    state.timeline = timelineData.timeline;
    renderTimeline();
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

async function saveTemplate() {
  const template = readTemplateFromForm();
  const data = await api("/api/template", {
    method: "PUT",
    body: JSON.stringify({ name: state.templateName, template }),
  });
  state.template = data.template;
  await loadSlotSelections();
  renderTemplate();
  log(`saved ${state.templateName}`);
}

async function renderRoughCut() {
  const template = readTemplateFromForm();
  const assetSelections = readAssetSelectionsFromForm();
  setBusy(true);
  log("render started");
  try {
    const data = await api("/api/render", {
      method: "POST",
      body: JSON.stringify({ template, assetSelections }),
    });
    state.timeline = data.timeline;
    state.outputExists = true;
    state.exportClips = data.exportClips || [];
    for (const warning of data.warnings || []) {
      log(warning, "warn");
    }
    renderTimeline();
    renderPreview(data.outputUrl);
    log("render finished");
  } catch (error) {
    log(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  elements.renderButton.disabled = isBusy;
  elements.saveButton.disabled = isBusy;
  elements.reloadButton.disabled = isBusy;
  elements.importJsonButton.disabled = isBusy;
  elements.voiceGenerateButton.disabled = isBusy;
  elements.mergeTimestampsButton.disabled = isBusy;
  elements.exportFolderButton.disabled = isBusy;
  elements.exportButton.disabled = isBusy || !state.exportClips?.length;
  elements.renderButton.textContent = isBusy ? "生成中" : "生成";
  elements.exportButton.textContent = isBusy ? "書き出し" : (state.exportClips?.length ? `書き出し (${state.exportClips.length})` : "書き出し");
  elements.projectStatus.textContent = isBusy ? "生成中" : `${state.templateName} / ${state.assets?.count || 0} assets`;
}

elements.reloadButton.addEventListener("click", () => {
  loadState().catch((error) => log(error.message, "error"));
});

elements.saveButton.addEventListener("click", () => {
  saveTemplate().catch((error) => log(error.message, "error"));
});

elements.renderButton.addEventListener("click", renderRoughCut);

elements.voiceGenerateButton.addEventListener("click", () => {
  generateVoice().catch((error) => log(error.message, "error"));
});

elements.mergeTimestampsButton.addEventListener("click", () => {
  mergeTimestamps().catch((error) => log(error.message, "error"));
});

elements.exportFolderButton.addEventListener("click", () => {
  chooseExportFolder().catch((error) => log(error.message, "error"));
});

elements.importJsonButton.addEventListener("click", () => {
  elements.jsonFileInput.click();
});

elements.jsonFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) {
    return;
  }
  try {
    await importTemplateJson(file);
  } catch (error) {
    log(error.message, "error");
  }
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

elements.templateSelect.addEventListener("change", async (event) => {
  state.templateName = event.target.value;
  await loadTemplate(state.templateName);
  await loadSlotSelections();
  renderAll();
  log(`selected ${state.templateName}`);
});

elements.clearLogButton.addEventListener("click", () => {
  elements.logOutput.textContent = "";
});

loadState().catch((error) => {
  elements.projectStatus.textContent = "読み込み失敗";
  log(error.message, "error");
});

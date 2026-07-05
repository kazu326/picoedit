const state = {
  templates: [],
  templateName: "ai_prompt_30s.json",
  template: null,
  assets: null,
  timeline: null,
  outputExists: false,
  slotSelections: {},
  timelineRoughCut: null,
  timelineBridgeError: null,
};

const elements = {
  projectStatus: document.querySelector("#projectStatus"),
  templateSelect: document.querySelector("#templateSelect"),
  reloadButton: document.querySelector("#reloadButton"),
  saveButton: document.querySelector("#saveButton"),
  renderButton: document.querySelector("#renderButton"),
  timelineRenderButton: document.querySelector("#timelineRenderButton"),
  templateId: document.querySelector("#templateId"),
  outputSize: document.querySelector("#outputSize"),
  fps: document.querySelector("#fps"),
  slotRows: document.querySelector("#slotRows"),
  previewVideo: document.querySelector("#previewVideo"),
  emptyPreview: document.querySelector("#emptyPreview"),
  outputMeta: document.querySelector("#outputMeta"),
  timelineMeta: document.querySelector("#timelineMeta"),
  timelinePipelineMeta: document.querySelector("#timelinePipelineMeta"),
  timelineRows: document.querySelector("#timelineRows"),
  assetMeta: document.querySelector("#assetMeta"),
  assetFolders: document.querySelector("#assetFolders"),
  logOutput: document.querySelector("#logOutput"),
  clearLogButton: document.querySelector("#clearLogButton"),
};

const timelineBridgeBase = `http://${window.location.hostname || "127.0.0.1"}:8766`;

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
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function timelineApi(path, options = {}) {
  let response;
  try {
    response = await fetch(`${timelineBridgeBase}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("音声タイムライン連携が起動していません。PicoEditを終了し、npm start で再起動してください。");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Timeline request failed: ${response.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatSeconds(value) {
  return `${asNumber(value).toFixed(2)}s`;
}

function folderOptions(selectedFolder) {
  return (state.assets?.folders || [])
    .map(({ folder, count }) => `<option value="${escapeHtml(folder)}" ${folder === selectedFolder ? "selected" : ""}>${escapeHtml(folder)} (${count})</option>`)
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
  const candidates = selectedAsset && !folderAssets.some((asset) => asset.path === selectedAsset.path)
    ? [selectedAsset, ...folderAssets]
    : folderAssets;
  return candidates
    .map((asset) => `<option value="${escapeHtml(asset.path)}" ${asset.path === selectedPath ? "selected" : ""}>${escapeHtml(asset.name)}</option>`)
    .join("");
}

function fileNameFromPath(assetPath) {
  return String(assetPath || "").split("/").pop() || "-";
}

function readTemplateFromForm() {
  return {
    template_id: elements.templateId.value.trim(),
    output_size: elements.outputSize.value.trim(),
    fps: Number(elements.fps.value),
    slots: [...elements.slotRows.querySelectorAll("tr")].map((row) => ({
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
    if (assetPath) selections[row.dataset.slotId] = assetPath;
  }
  return selections;
}

function updateSlotSelectionView(row, assetPath) {
  const asset = findAsset(assetPath);
  const video = row.querySelector("[data-role='slot-preview']");
  row.querySelector("[data-role='asset-name']").textContent = asset?.name || fileNameFromPath(assetPath);
  row.querySelector("[data-role='asset-path']").textContent = assetPath || "-";
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
      <td class="slot-id">${escapeHtml(slot.slot_id)}</td>
      <td><input data-field="label" type="text" value="${escapeHtml(slot.label)}"></td>
      <td><select data-field="folder">${folderOptions(slot.folder)}</select></td>
      <td><input data-field="target_duration" type="number" min="0.1" step="0.1" value="${slot.target_duration}"></td>
      <td class="asset-cell"><strong data-role="asset-name">${escapeHtml(fileNameFromPath(selectedAsset))}</strong><p data-role="asset-path">${escapeHtml(selectedAsset || "-")}</p></td>
      <td><video class="slot-preview-video" data-role="slot-preview" muted controls preload="metadata"></video></td>
      <td class="asset-actions"><button type="button" data-action="change-asset">素材を変更</button><select class="asset-picker" data-field="asset" hidden>${assetOptions(selectedAsset, slot.folder)}</select></td>
    `;
    elements.slotRows.appendChild(row);
    const folderSelect = row.querySelector("[data-field='folder']");
    const picker = row.querySelector("[data-field='asset']");
    picker.addEventListener("change", () => {
      setRowAsset(row, slot.slot_id, picker.value);
      log(`${slot.slot_id} asset changed to ${fileNameFromPath(picker.value)}`);
    });
    folderSelect.addEventListener("change", () => {
      const folderAssets = assetsForFolder(folderSelect.value);
      picker.innerHTML = assetOptions(folderAssets[0]?.path || "", folderSelect.value);
      setRowAsset(row, slot.slot_id, folderAssets[0]?.path || "");
      log(`${slot.slot_id} folder changed to ${folderSelect.value}`, folderAssets.length ? "info" : "warn");
    });
    row.querySelector("[data-action='change-asset']").addEventListener("click", () => {
      picker.hidden = !picker.hidden;
      if (!picker.hidden) picker.focus();
    });
    updateSlotSelectionView(row, selectedAsset);
  }
}

function renderTemplates() {
  elements.templateSelect.innerHTML = state.templates
    .map((name) => `<option value="${escapeHtml(name)}" ${name === state.templateName ? "selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
}

function renderPreview(outputUrl = null) {
  const frame = elements.previewVideo.closest(".preview-frame");
  const url = outputUrl || (state.outputExists ? `/media/output/rough_cut.mp4?v=${Date.now()}` : null);
  if (url) {
    elements.previewVideo.src = url;
    frame.classList.add("has-video");
  } else {
    elements.previewVideo.removeAttribute("src");
    frame.classList.remove("has-video");
  }
}

function timelineAssignments(plan) {
  if (Array.isArray(plan?.assignments)) return plan.assignments;
  if (Array.isArray(plan?.segments)) return plan.segments;
  return [];
}

function assignmentValue(item, names, fallback = "") {
  for (const name of names) {
    if (item?.[name] !== undefined && item?.[name] !== null && item?.[name] !== "") return item[name];
  }
  return fallback;
}

function renderTimeline() {
  const plan = state.timelineRoughCut?.plan;
  const assignments = timelineAssignments(plan);
  elements.timelineRows.innerHTML = "";

  if (assignments.length) {
    const duration = assignmentValue(plan, ["expected_duration", "voice_duration", "output_duration"], assignmentValue(assignments.at(-1), ["end"], 0));
    elements.timelineMeta.textContent = `${assignments.length} blocks / ${formatSeconds(duration)} / 音声基準`;
    const check = state.timelineRoughCut?.manifest_check;
    const assetCount = assignmentValue(check, ["recognized_video_count", "video_count", "valid_video_count"], 0);
    elements.timelinePipelineMeta.textContent = assetCount ? `素材 ${assetCount}本 / 自動割当済み` : "音声タイムライン方式";
    elements.outputMeta.textContent = state.timelineRoughCut?.output_exists ? `${formatSeconds(assignmentValue(plan, ["rough_cut_duration", "output_duration", "audio_duration"], duration))} / 1080x1920` : "-";

    for (const item of assignments) {
      const id = assignmentValue(item, ["segment_id", "id", "slot_id"], "segment");
      const role = assignmentValue(item, ["role"], "-");
      const start = asNumber(assignmentValue(item, ["start"], 0));
      const end = asNumber(assignmentValue(item, ["end"], start));
      const asset = assignmentValue(item, ["asset_path", "asset"], "-");
      const mode = assignmentValue(item, ["render_mode", "mode"], "-");
      const row = document.createElement("article");
      row.className = "timeline-row";
      row.innerHTML = `
        <header><span>${escapeHtml(id)} / ${escapeHtml(role)}</span><span>${start.toFixed(2)}-${end.toFixed(2)}s</span></header>
        <p>${escapeHtml(asset)}</p>
        <p>${escapeHtml(mode)}</p>
      `;
      elements.timelineRows.appendChild(row);
    }
    return;
  }

  const segments = state.timeline?.segments || [];
  if (segments.length) {
    const total = asNumber(segments.at(-1).end);
    elements.timelineMeta.textContent = `${segments.length} slots / ${formatSeconds(total)} / 旧テンプレート`;
    elements.timelinePipelineMeta.textContent = "音声タイムラインは未生成";
    elements.outputMeta.textContent = state.outputExists ? `${formatSeconds(total)} / 1080x1920` : "-";
    for (const segment of segments) {
      const row = document.createElement("article");
      row.className = "timeline-row";
      row.innerHTML = `<header><span>${escapeHtml(segment.slot_id)} / ${escapeHtml(segment.label)}</span><span>${asNumber(segment.start).toFixed(1)}-${asNumber(segment.end).toFixed(1)}s</span></header><p>${escapeHtml(segment.asset)}</p><p>speed ${asNumber(segment.speed, 1).toFixed(3)}x</p>`;
      elements.timelineRows.appendChild(row);
    }
    return;
  }

  elements.timelineMeta.textContent = "未生成";
  elements.outputMeta.textContent = "-";
  elements.timelinePipelineMeta.textContent = state.timelineBridgeError || "timeline_with_captions.json → 素材 → rough_cut.mp4";
  elements.timelineRows.innerHTML = `<div class="timeline-row"><p>上部の「音声タイムライン生成」を押すと、台帳確認・7ブロックの自動割当・rough_cut.mp4出力をまとめて実行します。</p></div>`;
}

function renderAssets() {
  const folders = state.assets?.folders || [];
  elements.assetMeta.textContent = `${state.assets?.count || 0} files`;
  elements.assetFolders.innerHTML = "";
  for (const group of folders) {
    const node = document.createElement("article");
    node.className = "asset-folder";
    node.innerHTML = `<header><span>${escapeHtml(group.folder)}</span><span>${group.count}</span></header><ul>${group.files.map((file) => `<li>${escapeHtml(file.name)}</li>`).join("")}</ul>`;
    elements.assetFolders.appendChild(node);
  }
}

function renderAll() {
  renderTemplates();
  renderTemplate();
  renderTimeline();
  renderAssets();
  renderPreview(state.timelineRoughCut?.output_url || null);
  const bridge = state.timelineBridgeError ? " / 音声タイムライン連携未起動" : "";
  elements.projectStatus.textContent = `${state.templateName} / ${state.assets?.count || 0} assets${bridge}`;
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
  state.slotSelections = Object.fromEntries((data.selections || []).map((selection) => [selection.slot_id, selection.asset]));
  for (const warning of data.warnings || []) log(warning, "warn");
}

async function loadTimelineRoughCutStatus() {
  try {
    state.timelineRoughCut = await timelineApi("/api/status");
    state.timelineBridgeError = state.timelineRoughCut.scripts_ready ? null : "必要なタイムライン用スクリプトが見つかりません";
  } catch (error) {
    state.timelineRoughCut = null;
    state.timelineBridgeError = error.message;
  }
}

async function loadState() {
  const data = await api("/api/state");
  state.templates = data.templates;
  state.assets = data.assets;
  state.timeline = data.timeline;
  state.outputExists = data.outputExists;
  if (!state.templates.includes(state.templateName)) state.templateName = state.templates[0] || state.templateName;
  await loadTemplate(state.templateName);
  await loadSlotSelections();
  await loadTimelineRoughCutStatus();
  renderAll();
  log("loaded project state");
}

async function saveTemplate() {
  const data = await api("/api/template", {
    method: "PUT",
    body: JSON.stringify({ name: state.templateName, template: readTemplateFromForm() }),
  });
  state.template = data.template;
  await loadSlotSelections();
  renderTemplate();
  log(`saved ${state.templateName}`);
}

async function renderLegacyRoughCut() {
  setBusy(true, "legacy");
  log("旧テンプレート方式の生成を開始します。音声タイムライン方式ではありません。", "warn");
  try {
    const data = await api("/api/render", {
      method: "POST",
      body: JSON.stringify({ template: readTemplateFromForm(), assetSelections: readAssetSelectionsFromForm() }),
    });
    state.timeline = data.timeline;
    state.outputExists = true;
    for (const warning of data.warnings || []) log(warning, "warn");
    renderTimeline();
    renderPreview(data.outputUrl);
    log("旧テンプレート生成が完了しました", "warn");
  } catch (error) {
    log(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function renderTimelineRoughCut() {
  setBusy(true, "timeline");
  log("音声タイムライン方式: 台帳確認 → 自動割当 → rough_cut.mp4 を開始しました");
  try {
    const data = await timelineApi("/api/render", { method: "POST", body: "{}" });
    state.timelineRoughCut = data;
    state.timelineBridgeError = null;
    state.outputExists = Boolean(data.output_exists);
    for (const chunk of data.logs || []) log(chunk);
    renderTimeline();
    renderPreview(data.output_url);
    log("音声タイムライン・ラフカット生成が完了しました");
  } catch (error) {
    state.timelineBridgeError = error.message;
    renderTimeline();
    log(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy, mode = "") {
  elements.renderButton.disabled = isBusy;
  elements.timelineRenderButton.disabled = isBusy;
  elements.saveButton.disabled = isBusy;
  elements.reloadButton.disabled = isBusy;
  elements.renderButton.textContent = isBusy && mode === "legacy" ? "旧方式生成中" : "旧テンプレート生成";
  elements.timelineRenderButton.textContent = isBusy && mode === "timeline" ? "音声タイムライン生成中" : "音声タイムライン生成";
  elements.projectStatus.textContent = isBusy ? "生成中" : `${state.templateName} / ${state.assets?.count || 0} assets`;
}

elements.reloadButton.addEventListener("click", () => loadState().catch((error) => log(error.message, "error")));
elements.saveButton.addEventListener("click", () => saveTemplate().catch((error) => log(error.message, "error")));
elements.renderButton.addEventListener("click", renderLegacyRoughCut);
elements.timelineRenderButton.addEventListener("click", renderTimelineRoughCut);
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

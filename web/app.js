const state = {
  templates: [],
  templateName: "ai_prompt_30s.json",
  template: null,
  assets: null,
  timeline: null,
  outputExists: false,
  slotSelections: {},
};

const elements = {
  projectStatus: document.querySelector("#projectStatus"),
  templateSelect: document.querySelector("#templateSelect"),
  reloadButton: document.querySelector("#reloadButton"),
  saveButton: document.querySelector("#saveButton"),
  renderButton: document.querySelector("#renderButton"),
  templateId: document.querySelector("#templateId"),
  outputSize: document.querySelector("#outputSize"),
  fps: document.querySelector("#fps"),
  slotRows: document.querySelector("#slotRows"),
  previewVideo: document.querySelector("#previewVideo"),
  emptyPreview: document.querySelector("#emptyPreview"),
  outputMeta: document.querySelector("#outputMeta"),
  timelineMeta: document.querySelector("#timelineMeta"),
  timelineRows: document.querySelector("#timelineRows"),
  assetMeta: document.querySelector("#assetMeta"),
  assetFolders: document.querySelector("#assetFolders"),
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
      <td class="slot-id">${escapeHtml(slot.slot_id)}</td>
      <td><input data-field="label" type="text" value="${escapeHtml(slot.label)}"></td>
      <td><select data-field="folder">${folderOptions(slot.folder)}</select></td>
      <td><input data-field="target_duration" type="number" min="0.1" step="0.1" value="${slot.target_duration}"></td>
      <td class="asset-cell">
        <strong data-role="asset-name">${escapeHtml(fileNameFromPath(selectedAsset))}</strong>
        <p data-role="asset-path">${escapeHtml(selectedAsset || "-")}</p>
      </td>
      <td>
        <video class="slot-preview-video" data-role="slot-preview" muted controls preload="metadata"></video>
      </td>
      <td class="asset-actions">
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
  } else {
    elements.previewVideo.removeAttribute("src");
    frame.classList.remove("has-video");
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

function renderAll() {
  renderTemplates();
  renderTemplate();
  renderTimeline();
  renderAssets();
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
  if (!state.templates.includes(state.templateName)) {
    state.templateName = state.templates[0] || state.templateName;
  }
  await loadTemplate(state.templateName);
  await loadSlotSelections();
  renderAll();
  log("loaded project state");
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
  elements.renderButton.textContent = isBusy ? "生成中" : "生成";
  elements.projectStatus.textContent = isBusy ? "生成中" : `${state.templateName} / ${state.assets?.count || 0} assets`;
}

elements.reloadButton.addEventListener("click", () => {
  loadState().catch((error) => log(error.message, "error"));
});

elements.saveButton.addEventListener("click", () => {
  saveTemplate().catch((error) => log(error.message, "error"));
});

elements.renderButton.addEventListener("click", renderRoughCut);

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

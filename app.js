/* global EpubCore */

const state = {
  title: "未命名图文集",
  author: "",
  language: "zh-CN",
  publisher: "",
  description: "",
  coverItemId: null,
  items: [],
};

const elements = {
  title: document.querySelector("#book-title"),
  author: document.querySelector("#book-author"),
  language: document.querySelector("#book-language"),
  publisher: document.querySelector("#book-publisher"),
  description: document.querySelector("#book-description"),
  list: document.querySelector("#content-list"),
  empty: document.querySelector("#empty-state"),
  stats: document.querySelector("#content-stats"),
  status: document.querySelector("#status"),
  dropZone: document.querySelector("#drop-zone"),
  textFiles: document.querySelector("#text-files"),
  imageFiles: document.querySelector("#image-files"),
  projectFile: document.querySelector("#project-file"),
  textDialog: document.querySelector("#text-dialog"),
  textForm: document.querySelector("#text-form"),
  chapterTitle: document.querySelector("#chapter-title"),
  chapterFormat: document.querySelector("#chapter-format"),
  chapterContent: document.querySelector("#chapter-content"),
  textSubmit: document.querySelector("#text-submit-button"),
  template: document.querySelector("#item-template"),
};

function createId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function basename(filename) {
  return filename.replace(/\.[^.]+$/, "") || filename;
}

function isTextFile(file) {
  return /\.(txt|md|markdown)$/i.test(file.name) || file.type.startsWith("text/");
}

// .md stays Markdown; .txt and other text files are plain text.
function textFormat(file) {
  return /\.(md|markdown)$/i.test(file.name) || file.type === "text/markdown" ? "markdown" : "plain";
}

function imageMime(file) {
  if (file.type?.startsWith("image/")) return file.type;
  return EpubCore.mimeFromFilename(file.name);
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`.trim();
}

function syncBookFromFields() {
  state.title = elements.title.value.trim();
  state.author = elements.author.value.trim();
  state.language = elements.language.value;
  state.publisher = elements.publisher.value.trim();
  state.description = elements.description.value.trim();
}

function syncFieldsFromBook() {
  elements.title.value = state.title || "";
  elements.author.value = state.author || "";
  elements.language.value = state.language || "zh-CN";
  elements.publisher.value = state.publisher || "";
  elements.description.value = state.description || "";
}

function updateStats() {
  const characters = state.items
    .filter((item) => item.type === "text")
    .reduce((sum, item) => sum + String(item.content || "").replace(/\s/g, "").length, 0);
  const images = state.items.filter((item) => item.type === "image").length;
  elements.stats.textContent = `${state.items.length} 个条目 · ${characters.toLocaleString("zh-CN")} 字${images ? ` · ${images} 图` : ""}`;
}

function makeButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function moveItem(itemId, direction) {
  const index = state.items.findIndex((item) => item.id === itemId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= state.items.length) return;
  [state.items[index], state.items[destination]] = [state.items[destination], state.items[index]];
  renderItems();
}

function removeItem(itemId) {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index < 0) return;
  const [removed] = state.items.splice(index, 1);
  if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  if (state.coverItemId === itemId) state.coverItemId = null;
  renderItems();
  setStatus(`已移除“${removed.title}”。`);
}

function addMeta(fields, text) {
  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.textContent = text;
  fields.append(meta);
  return meta;
}

function addToggle(container, label, checked, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "item-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.append(input, label);
  container.append(wrapper);
}

let draggedId = null;

function renderItems() {
  elements.list.replaceChildren();
  elements.empty.hidden = state.items.length > 0;

  state.items.forEach((item, index) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    card.querySelector(".item-index").textContent = String(index + 1).padStart(2, "0");
    const preview = card.querySelector(".item-preview");
    const fields = card.querySelector(".item-fields");
    const actions = card.querySelector(".item-actions");
    const handle = card.querySelector(".drag-handle");

    const title = document.createElement("input");
    title.type = "text";
    title.value = item.title;
    title.maxLength = 120;
    title.setAttribute("aria-label", `第 ${index + 1} 项标题`);
    title.addEventListener("input", () => {
      item.title = title.value;
    });
    fields.append(title);

    if (item.type === "text") {
      const plain = item.format === "plain";
      preview.textContent = "¶";
      const excerpt = document.createElement("button");
      excerpt.type = "button";
      excerpt.className = "content-excerpt";
      const content = String(item.content || "");
      excerpt.textContent = (plain ? content : content.replace(/[#*_>`~-]/g, "")).replace(/\s+/g, " ").trim() || "空章节，点击编辑正文";
      excerpt.title = "点击编辑正文";
      excerpt.addEventListener("click", () => openTextDialog(item));
      fields.append(excerpt);
      addMeta(fields, `文字章节 · ${plain ? "纯文本" : "Markdown"} · ${content.replace(/\s/g, "").length.toLocaleString("zh-CN")} 字`);
      actions.append(makeButton("编辑正文", "edit-item", () => openTextDialog(item)));
    } else {
      const image = document.createElement("img");
      image.src = item.previewUrl;
      image.alt = "";
      preview.append(image);
      const caption = document.createElement("textarea");
      caption.value = item.caption || item.alt || "";
      caption.placeholder = "图片说明 / 替代文本（推荐填写）";
      caption.setAttribute("aria-label", `${item.title}的图片说明`);
      caption.addEventListener("input", () => {
        item.caption = caption.value;
        item.alt = caption.value || item.title;
      });
      fields.append(caption);
      const meta = addMeta(fields, `${item.mimeType.replace("image/", "")} · ${formatBytes(item.data.length)}`);
      if (state.coverItemId === item.id) {
        const cover = document.createElement("span");
        cover.className = "cover-tag";
        cover.textContent = "封面";
        meta.append(cover);
      }
      actions.append(
        makeButton(state.coverItemId === item.id ? "取消封面" : "设为封面", "cover-item", () => {
          state.coverItemId = state.coverItemId === item.id ? null : item.id;
          renderItems();
        }),
      );
    }

    // Off for continuation segments of a chapter that is split by illustrations.
    const options = document.createElement("div");
    options.className = "item-options";
    addToggle(options, "列入目录", item.toc !== false, (checked) => {
      item.toc = checked;
    });
    if (item.type === "text") {
      addToggle(options, "显示标题", item.showTitle !== false, (checked) => {
        item.showTitle = checked;
      });
    }
    fields.append(options);

    actions.append(makeButton("上移", "move-item", () => moveItem(item.id, -1)));
    actions.append(makeButton("下移", "move-item", () => moveItem(item.id, 1)));
    actions.append(makeButton("移除", "remove-item", () => removeItem(item.id)));

    handle.addEventListener("dragstart", (event) => {
      draggedId = item.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
      requestAnimationFrame(() => card.classList.add("is-dragging"));
    });
    handle.addEventListener("dragend", () => {
      draggedId = null;
      card.classList.remove("is-dragging");
      document.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    });
    card.addEventListener("dragover", (event) => {
      if (!draggedId || draggedId === item.id) return;
      event.preventDefault();
      card.classList.add("is-drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
    card.addEventListener("drop", (event) => {
      if (!draggedId || draggedId === item.id) return;
      event.preventDefault();
      event.stopPropagation();
      const from = state.items.findIndex((candidate) => candidate.id === draggedId);
      const [moved] = state.items.splice(from, 1);
      const to = state.items.findIndex((candidate) => candidate.id === item.id);
      state.items.splice(to, 0, moved);
      draggedId = null;
      renderItems();
    });

    elements.list.append(card);
  });

  updateStats();
}

function openTextDialog(item = null) {
  elements.textForm.dataset.editingId = item?.id || "";
  elements.chapterTitle.value = item?.title || `第 ${state.items.filter((entry) => entry.type === "text").length + 1} 章`;
  elements.chapterFormat.value = item?.format === "plain" ? "plain" : "markdown";
  elements.chapterContent.value = item?.content || "";
  elements.textDialog.querySelector(".dialog-heading h2").textContent = item ? "编辑文字章节" : "新建文字章节";
  elements.textSubmit.textContent = item ? "保存修改" : "加入书稿";
  elements.textDialog.showModal();
  setTimeout(() => elements.chapterTitle.select(), 0);
}

async function importTextFiles(fileList) {
  const files = Array.from(fileList).filter(isTextFile);
  for (const file of files) {
    state.items.push({
      id: createId("text"),
      type: "text",
      title: basename(file.name),
      format: textFormat(file),
      // file.text() only reads UTF-8; GBK TXT files would become mojibake.
      content: EpubCore.decodeText(new Uint8Array(await file.arrayBuffer())),
      sourceName: file.name,
    });
  }
  renderItems();
  if (files.length) setStatus(`已导入 ${files.length} 个文本文件。`, "success");
  return files.length;
}

async function importImageFiles(fileList) {
  const files = Array.from(fileList).filter((file) => imageMime(file));
  let imported = 0;
  let coverSet = false;
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    // The real format decides, not the extension (e.g. WebP saved as .jpg).
    const mimeType = EpubCore.sniffImageType(data);
    if (!mimeType) continue;
    const item = {
      id: createId("image"),
      type: "image",
      title: basename(file.name),
      name: file.name,
      mimeType,
      alt: basename(file.name),
      caption: "",
      data,
      previewUrl: URL.createObjectURL(new Blob([data], { type: mimeType })),
    };
    state.items.push(item);
    imported += 1;
    if (!state.coverItemId) {
      state.coverItemId = item.id;
      coverSet = true;
    }
  }
  renderItems();
  if (imported) setStatus(`已导入 ${imported} 张图片${coverSet ? "；第一张已设为封面" : ""}。`, "success");
  else if (files.length) setStatus("图片内容无法识别，只支持 JPG、PNG、GIF、WEBP、SVG。", "error");
  return imported;
}

async function importMixedFiles(fileList) {
  const files = Array.from(fileList);
  let count = 0;
  for (const file of files) {
    if (isTextFile(file)) count += await importTextFiles([file]);
    else if (imageMime(file)) count += await importImageFiles([file]);
  }
  if (!count) setStatus("没有找到可导入的 TXT、Markdown 或受支持图片。", "error");
}

function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function bytesToBase64(data) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const data = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index);
  return data;
}

function serializableBook() {
  syncBookFromFields();
  return {
    ...state,
    items: state.items.map((item) => {
      const copy = { ...item };
      delete copy.previewUrl;
      if (copy.type === "image") copy.dataBase64 = bytesToBase64(copy.data);
      delete copy.data;
      return copy;
    }),
  };
}

function saveProject() {
  try {
    const project = {
      format: "epub-studio-project",
      version: 1,
      savedAt: new Date().toISOString(),
      book: serializableBook(),
    };
    download(
      JSON.stringify(project, null, 2),
      EpubCore.suggestedFilename(state.title).replace(/\.epub$/i, ".epubproj.json"),
      "application/json",
    );
    setStatus("工程已保存。以后可用“打开工程”继续编辑。", "success");
  } catch (error) {
    setStatus(`保存失败：${error.message}`, "error");
  }
}

function releaseImageUrls() {
  for (const item of state.items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
}

async function openProject(file) {
  const project = JSON.parse(await file.text());
  if (project.format !== "epub-studio-project" || project.version !== 1 || !project.book) {
    throw new Error("这不是受支持的页间工程文件");
  }
  releaseImageUrls();
  Object.assign(state, project.book);
  state.items = (project.book.items || []).map((item) => {
    const restored = { ...item };
    if (restored.type === "image") {
      restored.data = base64ToBytes(restored.dataBase64 || "");
      delete restored.dataBase64;
      restored.previewUrl = URL.createObjectURL(new Blob([restored.data], { type: restored.mimeType }));
    }
    return restored;
  });
  syncFieldsFromBook();
  renderItems();
  setStatus(`已打开工程“${state.title}”。`, "success");
}

function exportEpub() {
  try {
    syncBookFromFields();
    const errors = EpubCore.validateBook(state);
    if (errors.length) throw new Error(errors.join("；"));
    setStatus("正在装订 EPUB……");
    const epub = EpubCore.buildEpub(state);
    download(epub, EpubCore.suggestedFilename(state.title), "application/epub+zip");
    setStatus(`导出完成：${EpubCore.suggestedFilename(state.title)}（${formatBytes(epub.length)}）`, "success");
  } catch (error) {
    setStatus(`导出失败：${error.message}`, "error");
  }
}

function clearBook(ask = true) {
  if (ask && state.items.length && !confirm("要清空当前书稿吗？尚未保存的内容将无法恢复。")) return false;
  releaseImageUrls();
  Object.assign(state, {
    title: "未命名图文集",
    author: "",
    language: "zh-CN",
    publisher: "",
    description: "",
    coverItemId: null,
    items: [],
  });
  syncFieldsFromBook();
  renderItems();
  setStatus("书稿已清空。", "");
  return true;
}

function loadSample() {
  if (!clearBook(state.items.length > 0)) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#20221c"/>
  <circle cx="900" cy="380" r="260" fill="#d9ff43"/>
  <path d="M0 1260 L1200 760 L1200 1600 L0 1600 Z" fill="#a64b35"/>
  <text x="105" y="190" fill="#f4f1e9" font-family="serif" font-size="74" letter-spacing="14">FIELD NOTES</text>
  <text x="100" y="1030" fill="#f4f1e9" font-family="serif" font-weight="700" font-size="148">远行手记</text>
  <text x="108" y="1130" fill="#f4f1e9" font-family="sans-serif" font-size="34">TEXT × IMAGE × MEMORY</text>
  </svg>`;
  const imageData = new TextEncoder().encode(svg);
  const imageId = createId("image");
  Object.assign(state, {
    title: "远行手记",
    author: "页间示例",
    language: "zh-CN",
    publisher: "独立出版",
    description: "一本由文字、图片和路途中的片刻组成的小书。",
    coverItemId: imageId,
    items: [
      {
        id: createId("text"),
        type: "text",
        title: "序 · 出发以前",
        content: "有些旅行先从一张空白纸开始。\n\n我们把地图折好，把熟悉的日常留在门后，然后出发。**这本小书**收下沿途的文字和画面。",
      },
      {
        id: imageId,
        type: "image",
        title: "远行手记",
        name: "cover.svg",
        mimeType: "image/svg+xml",
        alt: "远行手记抽象封面",
        caption: "出发，是故事的第一张图。",
        data: imageData,
        previewUrl: URL.createObjectURL(new Blob([imageData], { type: "image/svg+xml" })),
      },
      {
        id: createId("text"),
        type: "text",
        title: "第一章 · 清晨的站台",
        content: "# 六点十五分\n\n站台刚刚亮起来。广播声穿过薄雾，远处的车灯像一枚缓慢移动的标点。\n\n> 当城市还没完全醒来，离开显得格外真实。\n\n- 一杯热咖啡\n- 一张靠窗车票\n- 一本还没有写字的笔记本",
      },
    ],
  });
  syncFieldsFromBook();
  renderItems();
  setStatus("示例已载入。你可以直接编辑或导出 EPUB。", "success");
  document.querySelector(".workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelector("#new-text-button").addEventListener("click", () => openTextDialog());
document.querySelector("#import-text-button").addEventListener("click", () => elements.textFiles.click());
document.querySelector("#import-image-button").addEventListener("click", () => elements.imageFiles.click());
document.querySelector("#open-project-button").addEventListener("click", () => elements.projectFile.click());
document.querySelector("#save-project-button").addEventListener("click", saveProject);
document.querySelector("#export-button").addEventListener("click", exportEpub);
document.querySelector("#clear-button").addEventListener("click", () => clearBook(true));
document.querySelector("#load-sample-button").addEventListener("click", loadSample);

elements.textFiles.addEventListener("change", async () => {
  try { await importTextFiles(elements.textFiles.files); }
  catch (error) { setStatus(`文本导入失败：${error.message}`, "error"); }
  elements.textFiles.value = "";
});

elements.imageFiles.addEventListener("change", async () => {
  try { await importImageFiles(elements.imageFiles.files); }
  catch (error) { setStatus(`图片导入失败：${error.message}`, "error"); }
  elements.imageFiles.value = "";
});

elements.projectFile.addEventListener("change", async () => {
  try {
    if (elements.projectFile.files[0]) await openProject(elements.projectFile.files[0]);
  } catch (error) {
    setStatus(`工程打开失败：${error.message}`, "error");
  }
  elements.projectFile.value = "";
});

elements.textForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    elements.textDialog.close();
    return;
  }
  const title = elements.chapterTitle.value.trim();
  const format = elements.chapterFormat.value;
  const content = elements.chapterContent.value;
  if (!title || !content.trim()) return;
  const editingId = elements.textForm.dataset.editingId;
  const item = state.items.find((entry) => entry.id === editingId);
  if (item) {
    item.title = title;
    item.format = format;
    item.content = content;
    setStatus(`已更新“${title}”。`, "success");
  } else {
    state.items.push({ id: createId("text"), type: "text", title, format, content });
    setStatus(`已加入“${title}”。`, "success");
  }
  elements.textDialog.close();
  renderItems();
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    if (draggedId) return;
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    if (draggedId) return;
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", async (event) => {
  if (draggedId) return;
  try { await importMixedFiles(event.dataTransfer.files); }
  catch (error) { setStatus(`导入失败：${error.message}`, "error"); }
});

window.addEventListener("beforeunload", releaseImageUrls);
renderItems();

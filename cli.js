#!/usr/bin/env node
// 命令行装订：node cli.js book.json [out.epub]
const fs = require("node:fs");
const path = require("node:path");
const { buildEpub, decodeText, mimeFromFilename, suggestedFilename } = require("./epub-core.js");

const USAGE = `用法：node cli.js book.json [out.epub]

book.json 里的 file / coverFile 都相对于 book.json 所在目录。
不写 out.epub 时按书名在当前目录生成。`;

/** Read book.json and the files it points to. Returns { book, options } for buildEpub. */
function loadBook(jsonPath) {
  const base = path.dirname(path.resolve(jsonPath));
  const resolve = (file) => path.resolve(base, String(file));
  const read = (file, where) => {
    try {
      return new Uint8Array(fs.readFileSync(resolve(file)));
    } catch {
      throw new Error(`${where}：读不到文件 ${file}`);
    }
  };

  let config;
  try {
    config = JSON.parse(decodeText(fs.readFileSync(jsonPath)));
  } catch (error) {
    throw new Error(`book.json 读取失败：${error.message}`);
  }
  if (!Array.isArray(config.items)) throw new Error("book.json 需要 items 数组");

  const imageItem = (file, where, fields) => ({
    ...fields,
    type: "image",
    name: path.basename(String(file)),
    mimeType: mimeFromFilename(file),
    data: read(file, where),
  });

  const items = config.items.map((entry, index) => {
    const where = `第 ${index + 1} 项`;
    const item = { ...entry, id: entry.id ?? `item-${index + 1}` };
    if (item.type === "image") {
      if (!item.file) throw new Error(`${where}：图片需要 file`);
      return imageItem(item.file, where, item);
    }
    if (item.type === "text" && item.file) {
      item.content = decodeText(read(item.file, where));
      // Same as the browser import: .md is Markdown, anything else is plain text.
      item.format = item.format || (/\.(md|markdown)$/i.test(item.file) ? "markdown" : "plain");
    }
    return item;
  });

  let coverItemId = config.coverItemId ?? null;
  if (config.coverFile) {
    const coverPath = resolve(config.coverFile);
    const listed = items.find((item) => item.type === "image" && resolve(item.file) === coverPath);
    if (listed) {
      coverItemId = listed.id;
    } else {
      // A cover outside the reading order opens the book and stays out of the TOC.
      items.unshift(imageItem(config.coverFile, "coverFile", { id: "cover-file", title: "封面", toc: false }));
      coverItemId = "cover-file";
    }
  }

  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`items 中的 id 重复：${item.id}`);
    ids.add(item.id);
  }
  if (coverItemId !== null && !items.some((item) => item.type === "image" && item.id === coverItemId)) {
    throw new Error(`coverItemId 没有对应的图片：${coverItemId}`);
  }

  return {
    book: { ...config, items, coverItemId },
    options: { modified: config.modified },
  };
}

function main(args) {
  const [input, output] = args;
  if (!input || input === "-h" || input === "--help") {
    console.log(USAGE);
    return input ? 0 : 1;
  }
  const { book, options } = loadBook(input);
  const target = output || suggestedFilename(book.title);
  const epub = buildEpub(book, options);
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, epub);
  console.log(`已生成 ${target}（${book.items.length} 项，${(epub.length / 1024).toFixed(1)} KB）`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`装订失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { loadBook, main };

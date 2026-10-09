const encoder = new TextEncoder();

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const EXTENSION_MIMES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function bytes(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("ZIP 条目必须是字符串或二进制数据");
}

/** Decode a text file: BOM first, then strict UTF-8, then GB18030 (a superset of GBK). */
function decodeText(value) {
  if (typeof value === "string") return value;
  const data = bytes(value);
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder("utf-8").decode(data.subarray(3));
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("gb18030").decode(data);
  }
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const time =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, date: day };
}

function view(size) {
  const data = new Uint8Array(size);
  return { data, view: new DataView(data.buffer) };
}

/**
 * Build a standards-compliant ZIP archive using the "stored" method.
 * EPUB requires the mimetype entry to be first and uncompressed; storing every
 * entry keeps the app dependency-free and works well for already-compressed images.
 */
function buildZip(entries, timestamp = new Date()) {
  const archiveDate = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(archiveDate.getTime())) throw new TypeError("ZIP 时间戳必须是有效日期");
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const stamp = dosDateTime(archiveDate);

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replaceAll("\\", "/"));
    const payload = bytes(entry.data);
    const crc = crc32(payload);
    const local = view(30);
    const lv = local.view;
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, payload.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    localParts.push(local.data, name, payload);

    const central = view(46);
    const cv = central.view;
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, payload.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, localOffset, true);
    centralParts.push(central.data, name);

    localOffset += local.data.length + name.length + payload.length;
  }

  const centralData = concat(centralParts);
  const end = view(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, entries.length, true);
  end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, centralData.length, true);
  end.view.setUint32(16, localOffset, true);
  end.view.setUint16(20, 0, true);
  return concat([...localParts, centralData, end.data]);
}

// XML 1.0 forbids most C0 controls, U+FFFE/U+FFFF and unpaired surrogates.
const INVALID_XML = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/g;

function xmlChars(value) {
  return String(value).replace(INVALID_XML, (match) => (match.length === 2 ? match : ""));
}

function escapeXml(value = "") {
  return xmlChars(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function balancedTags(html) {
  const open = [];
  for (const [, closing, name] of html.matchAll(/<(\/?)(strong|em|del)>/g)) {
    if (!closing) open.push(name);
    else if (open.pop() !== name) return false;
  }
  return open.length === 0;
}

// \u0000 marks kept code/link fragments; escapeXml already removed real NULs.
function emphasis(text) {
  const html = text
    .replace(/\*\*([^*\u0000]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\u0000]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\u0000]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_\p{L}\p{N}])_([^_\u0000]+)_(?![\p{L}\p{N}])/gu, "$1<em>$2</em>")
    .replace(/~~([^~\u0000]+)~~/g, "<del>$1</del>");
  // Overlapping markers such as **a _b** c_ would nest badly; leave them as text.
  return balancedTags(html) ? html : text;
}

function inlineMarkdown(source) {
  const kept = [];
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
  const restore = (text) => text.replace(/\u0000(\d+)\u0000/g, (_, index) => restore(kept[Number(index)]));
  let text = escapeXml(source).replace(/`([^`]+)`/g, (_, content) => keep(`<code>${content}</code>`));
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_, label, href) => keep(`<a href="${href}">${emphasis(label)}</a>`),
  );
  return restore(emphasis(text));
}

// Han, kana, bopomofo, CJK punctuation and fullwidth forms. Hangul is left out: Korean uses spaces.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\u3000-\u303F\u30A0-\u30FF\uFE30-\uFE4F\uFF00-\uFFEF]/u;
// Quotes, dashes and ellipses are shared with Western text; they follow their neighbours.
const CJK_SHARED = /[\u00B7\u2014\u2015\u2018\u2019\u201C\u201D\u2026]/;

function cjkJoin(before, after) {
  const nearest = (chars) => chars.find((char) => !CJK_SHARED.test(char)) || "";
  const left = nearest(Array.from(before.slice(-32)).reverse());
  const right = nearest(Array.from(after.slice(0, 32)));
  if (!left && !right) return false;
  return (!left || CJK.test(left)) && (!right || CJK.test(right));
}

/** Join soft-wrapped lines: nothing between CJK characters, a space otherwise. */
function joinLines(lines) {
  let text = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (text) text += cjkJoin(text, line) ? "" : " ";
    text += line;
  }
  return text;
}

/** Convert a conservative Markdown subset to valid XHTML fragments. */
function markdownToXhtml(markdown = "") {
  const lines = String(markdown).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const output = [];
  let paragraph = [];
  let listType = null;
  let quote = [];
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(joinLines(paragraph))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };
  const flushQuote = () => {
    if (quote.length) output.push(`<blockquote><p>${inlineMarkdown(joinLines(quote))}</p></blockquote>`);
    quote = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      closeList();
      flushQuote();
      if (inCode) {
        output.push(`<pre><code>${escapeXml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    // Checked before lists so "* * *" and "- - -" stay rules, not list items.
    const rule = /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const blockquote = /^\s*>\s?(.*)$/.exec(line);

    if (heading) {
      flushParagraph();
      closeList();
      flushQuote();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (rule) {
      flushParagraph();
      closeList();
      flushQuote();
      output.push('<hr class="scene-break" />');
    } else if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const desired = unordered ? "ul" : "ol";
      if (listType !== desired) {
        closeList();
        output.push(`<${desired}>`);
        listType = desired;
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
    } else if (blockquote) {
      flushParagraph();
      closeList();
      quote.push(blockquote[1]);
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
      flushQuote();
    } else {
      closeList();
      flushQuote();
      paragraph.push(line.trim());
    }
  }

  if (inCode) output.push(`<pre><code>${escapeXml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  closeList();
  flushQuote();
  return output.join("\n");
}

// A line made only of these marks is a scene break: "***", "* * *", "---", "◇◇◇", "＊＊＊".
function isSceneBreak(line) {
  const marks = line.replace(/\s+/g, "");
  if (/^[◇◆◈○●◎☆★※⁂]+$/.test(marks)) return true;
  return marks.length >= 3 && /^[*＊\-－—―=＝~～_#＃]+$/.test(marks);
}

/** Plain text is not Markdown: every non-empty line is one paragraph. */
function plainTextToXhtml(text = "") {
  return xmlChars(text)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (isSceneBreak(line) ? '<hr class="scene-break" />' : `<p>${escapeXml(line)}</p>`))
    .join("\n");
}

function textToXhtml(item) {
  // Items saved before "format" existed are Markdown.
  return item.format === "plain" ? plainTextToXhtml(item.content || "") : markdownToXhtml(item.content || "");
}

function xhtmlDocument(title, body, bodyClass = "", language = "zh-CN") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css" />
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${body}
</body>
</html>`;
}

function mimeFromFilename(name = "") {
  return EXTENSION_MIMES[String(name).split(".").pop().toLowerCase()] || "";
}

/** Detect the real image format from its first bytes; "" when unknown. */
function sniffImageType(value) {
  const data = bytes(value);
  const starts = (...signature) => signature.every((byte, index) => byte === null || data[index] === byte);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  const text = new TextDecoder().decode(data.subarray(0, 4096));
  if (/^\s*</.test(text) && /<svg[\s>]/.test(text)) return "image/svg+xml";
  return "";
}

function imageBytes(item) {
  try {
    return bytes(item.data);
  } catch {
    return new Uint8Array();
  }
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function makeIdentifier() {
  if (globalThis.crypto?.randomUUID) return `urn:uuid:${globalThis.crypto.randomUUID()}`;
  const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return `urn:uuid:${(hash >>> 0).toString(16).padStart(8, "0")}-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
}

function safeFilename(value) {
  const clean = String(value || "book")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return clean || "book";
}

function suggestedFilename(title) {
  return `${safeFilename(title)}.epub`;
}

function validateBook(book) {
  const errors = [];
  if (!String(book?.title || "").trim()) errors.push("请填写书名");
  if (!Array.isArray(book?.items) || book.items.length === 0) errors.push("请至少添加一个文本章节或一张图片");
  // dc:language and lang attributes must be BCP 47 tags, or EPUBCheck rejects every page.
  const language = cleanText(book?.language);
  if (language && !/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(language)) {
    errors.push(`语言代码无效：${language}（例如 zh-CN、ja、en）`);
  }
  for (const item of book?.items || []) {
    if (item.type === "image") {
      const data = imageBytes(item);
      const label = item.name || item.title || item.mimeType || "未知文件";
      // Judge by content: downloaded illustrations are often WebP or PNG saved as .jpg.
      if (!data.length) errors.push(`图片没有数据：${label}`);
      else if (!sniffImageType(data)) errors.push(`不支持图片格式：${label}`);
    }
    if (item.type !== "text" && item.type !== "image") errors.push("工程中包含未知内容类型");
  }
  return errors;
}

/** Build an EPUB 3 file and return its bytes. */
function buildEpub(book, options = {}) {
  const errors = validateBook(book);
  if (errors.length) throw new Error(errors.join("；"));

  const title = cleanText(book.title);
  const author = cleanText(book.author);
  const translator = cleanText(book.translator);
  const publisher = cleanText(book.publisher);
  const description = cleanText(book.description);
  const language = cleanText(book.language) || "zh-CN";
  // Chinese and Japanese prose indents paragraphs by two characters unless turned off.
  const indent = book.paragraphIndent === undefined || book.paragraphIndent === null
    ? /^(zh|ja)(-|$)/i.test(language)
    : Boolean(book.paragraphIndent);
  const identifier = cleanText(book.identifier) || cleanText(options.identifier) || makeIdentifier();
  const modifiedDate = options.modified === undefined ? new Date() : new Date(options.modified);
  if (Number.isNaN(modifiedDate.getTime())) throw new Error("EPUB 修改时间必须是有效日期");
  const modified = modifiedDate.toISOString().replace(/\.\d{3}Z$/, "Z");
  const hasCover = book.coverItemId !== undefined && book.coverItemId !== null;
  const images = [];
  let cover = null;
  const manifest = [];
  const spine = [];
  const navEntries = [];
  const entries = [];

  book.items.forEach((item, index) => {
    const number = index + 1;
    const pageId = `page-${number}`;
    const pageName = `section-${String(number).padStart(3, "0")}.xhtml`;
    // A blank title would leave an empty <title> and an empty TOC link.
    const itemTitle = cleanText(item.title) || (item.type === "text" ? `章节 ${number}` : `图片 ${number}`);
    let body;

    if (item.type === "text") {
      // showTitle: false hides the visible heading; the <title> stays.
      const heading = item.showTitle === false ? "" : `<h1>${escapeXml(itemTitle)}</h1>\n`;
      body = `<article class="text-section${indent ? " indent" : ""}">\n${heading}${textToXhtml(item)}\n</article>`;
    } else {
      // Keyed by position, not item.id, so images without ids are all kept.
      const data = imageBytes(item);
      const mimeType = sniffImageType(data);
      const imageId = `image-${number}`;
      const imageName = `${imageId}.${MIME_EXTENSIONS[mimeType]}`;
      const image = { id: imageId, name: imageName, mimeType };
      images.push(image);
      if (!cover && hasCover && item.id === book.coverItemId) cover = image;
      entries.push({ name: `EPUB/images/${imageName}`, data });
      if (index === 0 && cover === image) {
        // The cover page already opens the book with this image; no second copy.
        navEntries.push({ href: "text/cover.xhtml", title: cleanText(item.title) || "封面", listed: item.toc !== false });
        return;
      }
      const alt = escapeXml(cleanText(item.alt) || cleanText(item.title) || "插图");
      const caption = String(item.caption || "").trim();
      body = `<figure class="image-section">\n<img src="../images/${imageName}" alt="${alt}" />${caption ? `\n<figcaption>${escapeXml(caption)}</figcaption>` : ""}\n</figure>`;
    }

    entries.push({
      name: `EPUB/text/${pageName}`,
      data: xhtmlDocument(itemTitle, body, item.type === "image" ? "image-page" : "text-page", language),
    });
    manifest.push(`<item id="${pageId}" href="text/${pageName}" media-type="application/xhtml+xml" />`);
    spine.push(`<itemref idref="${pageId}" />`);
    navEntries.push({ href: `text/${pageName}`, title: itemTitle, listed: item.toc !== false });
  });

  // toc: false leaves an item out of the nav, but the nav may not be an empty list.
  const listed = navEntries.filter((entry) => entry.listed);
  const navItems = (listed.length ? listed : navEntries.slice(0, 1))
    .map((entry) => `<li><a href="${entry.href}">${escapeXml(entry.title)}</a></li>`);

  if (cover) {
    entries.push({
      name: "EPUB/text/cover.xhtml",
      data: xhtmlDocument(
        `${title} - 封面`,
        `<div class="cover"><img src="../images/${cover.name}" alt="${escapeXml(title)} 封面" /></div>`,
        "cover-page",
        language,
      ),
    });
    manifest.unshift('<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml" />');
    spine.unshift('<itemref idref="cover-page" linear="yes" />');
  }

  for (const image of images) {
    const coverProperty = cover?.id === image.id ? ' properties="cover-image"' : "";
    manifest.push(`<item id="${image.id}" href="images/${image.name}" media-type="${image.mimeType}"${coverProperty} />`);
  }

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head><meta charset="UTF-8" /><title>目录</title><link rel="stylesheet" type="text/css" href="styles/book.css" /></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navItems.join("\n")}</ol></nav></body>
</html>`;

  const metadata = [
    `<dc:identifier id="BookId">${escapeXml(identifier)}</dc:identifier>`,
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<dc:language>${escapeXml(language)}</dc:language>`,
    author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : "",
    translator ? `<dc:contributor id="translator">${escapeXml(translator)}</dc:contributor>` : "",
    translator ? '<meta refines="#translator" property="role" scheme="marc:relators">trl</meta>' : "",
    publisher ? `<dc:publisher>${escapeXml(publisher)}</dc:publisher>` : "",
    description ? `<dc:description>${escapeXml(description)}</dc:description>` : "",
    `<meta property="dcterms:modified">${escapeXml(modified)}</meta>`,
    cover ? `<meta name="cover" content="${cover.id}" />` : "",
  ].filter(Boolean);

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="${escapeXml(language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metadata.join("\n")}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
<item id="css" href="styles/book.css" media-type="text/css" />
${manifest.join("\n")}
</manifest>
<spine>
${spine.join("\n")}
</spine>
</package>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`;

  const css = `@charset "UTF-8";
html { writing-mode: horizontal-tb; }
body { color: #211f1b; font-family: serif; line-height: 1.75; margin: 6%; }
h1, h2, h3 { line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 1.7em; margin: 0 0 1.4em; }
p { margin: 0 0 1em; text-align: justify; }
.indent > p { text-indent: 2em; }
.scene-break { border: 0; border-top: 1px solid #b9b09f; height: 0; margin: 2em auto; width: 30%; }
blockquote { border-left: .2em solid #988b73; margin: 1.5em 0; padding-left: 1em; }
pre { background: #f2eee6; overflow-wrap: anywhere; padding: 1em; white-space: pre-wrap; }
code { font-family: monospace; }
img { height: auto; max-width: 100%; }
.image-page, .cover-page { margin: 0; padding: 0; }
.image-section, .cover { align-items: center; display: flex; flex-direction: column; justify-content: center; margin: 0; min-height: 95vh; text-align: center; }
.image-section img, .cover img { max-height: 90vh; object-fit: contain; }
figcaption { color: #645d52; font-size: .9em; margin-top: .8em; }
nav ol { line-height: 2; padding-left: 1.4em; }
nav a { color: inherit; text-decoration: none; }`;

  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "EPUB/package.opf", data: opf },
    { name: "EPUB/nav.xhtml", data: nav },
    { name: "EPUB/styles/book.css", data: css },
    ...entries,
  ], modifiedDate);
}

const EpubCore = Object.freeze({
  buildEpub,
  buildZip,
  decodeText,
  escapeXml,
  makeIdentifier,
  markdownToXhtml,
  mimeFromFilename,
  plainTextToXhtml,
  sniffImageType,
  suggestedFilename,
  validateBook,
});

if (typeof module !== "undefined" && module.exports) module.exports = EpubCore;
globalThis.EpubCore = EpubCore;

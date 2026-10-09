const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { loadBook } = require("../cli.js");
const {
  buildEpub,
  decodeText,
  makeIdentifier,
  markdownToXhtml,
  mimeFromFilename,
  plainTextToXhtml,
  sniffImageType,
  suggestedFilename,
  validateBook,
} = require("../epub-core.js");

function readStoredZip(data) {
  const entries = new Map();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(data.subarray(nameStart, nameStart + nameLength));
    assert.equal(method, 0, `${name} should use the ZIP stored method`);
    entries.set(name, data.slice(contentStart, contentStart + size));
    offset = contentStart + size;
  }
  return entries;
}

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

const book = {
  title: "测试 & 图文集",
  author: "页间测试",
  language: "zh-CN",
  publisher: "本地出版",
  description: "用于验证 EPUB 结构。",
  coverItemId: "image-cover",
  items: [
    {
      id: "text-one",
      type: "text",
      title: "第一章 <开始>",
      content: "# 小标题\n\n正文含 **粗体** 与一个列表。\n\n- A\n- B",
    },
    {
      id: "image-cover",
      type: "image",
      title: "封面",
      name: "cover.png",
      mimeType: "image/png",
      alt: "一张测试封面",
      caption: "测试图片",
      data: png,
    },
  ],
};

assert.deepEqual(validateBook(book), []);
assert.deepEqual(validateBook({ title: "", items: [] }), ["请填写书名", "请至少添加一个文本章节或一张图片"]);
assert.equal(suggestedFilename('一本:书?'), "一本-书-.epub");
assert.match(makeIdentifier(), /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const markdown = markdownToXhtml("# 标题\n\n<script>bad()</script>\n\n**粗体**");
assert.match(markdown, /<h1>标题<\/h1>/);
assert.match(markdown, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
assert.match(markdown, /<strong>粗体<\/strong>/);

// Markup must never leak into link targets or break nesting.
assert.equal(
  markdownToXhtml("[看这里](https://example.com/a_b_c?x=*y*)"),
  '<p><a href="https://example.com/a_b_c?x=*y*">看这里</a></p>',
);
assert.equal(markdownToXhtml("[**粗** 链接](https://example.com)"), '<p><a href="https://example.com"><strong>粗</strong> 链接</a></p>');
assert.equal(markdownToXhtml("[`代码`](https://example.com)"), '<p><a href="https://example.com"><code>代码</code></a></p>');
assert.equal(markdownToXhtml("**a _b** c_"), "<p>**a _b** c_</p>");
assert.equal(markdownToXhtml("*a **b** c*"), "<p><em>a <strong>b</strong> c</em></p>");
assert.equal(markdownToXhtml("snake_case_name 与 _强调_"), "<p>snake_case_name 与 <em>强调</em></p>");
// Characters XML 1.0 cannot carry are dropped instead of producing a broken file.
assert.equal(markdownToXhtml("甲\u000c乙\u0001丙\u0000CODE0\u0000丁"), "<p>甲乙丙CODE0丁</p>");
assert.equal(markdownToXhtml("𠀀\ud800"), "<p>𠀀</p>");
// "* * *" and "- - -" are rules, not list items.
for (const rule of ["***", "* * *", "- - -", "___"]) {
  assert.equal(markdownToXhtml(`前文\n\n${rule}\n\n后文`), '<p>前文</p>\n<hr class="scene-break" />\n<p>后文</p>');
}
assert.equal(markdownToXhtml("- 甲\n- 乙"), "<ul>\n<li>甲</li>\n<li>乙</li>\n</ul>");

// Soft line breaks: no space between CJK characters, a space elsewhere.
assert.equal(markdownToXhtml("第一行\n第二行"), "<p>第一行第二行</p>");
assert.equal(markdownToXhtml("ひらがなの\nカタカナ。\n（注）"), "<p>ひらがなのカタカナ。（注）</p>");
assert.equal(markdownToXhtml("他说：“走吧。”\n然后……\n——没有回头"), "<p>他说：“走吧。”然后……——没有回头</p>");
assert.equal(markdownToXhtml("……\n他沉默了"), "<p>……他沉默了</p>");
assert.equal(markdownToXhtml("He said “hi”\n“yes”"), "<p>He said “hi” “yes”</p>");
assert.equal(markdownToXhtml("Hello\nworld"), "<p>Hello world</p>");
assert.equal(markdownToXhtml("中文\nEnglish\n中文"), "<p>中文 English 中文</p>");
assert.equal(markdownToXhtml("𠀀\n𠀁"), "<p>𠀀𠀁</p>");
assert.equal(markdownToXhtml("한국어\n문장"), "<p>한국어 문장</p>");
assert.equal(markdownToXhtml("> 引用第一行\n> 第二行"), "<blockquote><p>引用第一行第二行</p></blockquote>");

const epub = buildEpub(book, {
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000001",
  modified: "2026-08-30T00:00:00Z",
});
const epubView = new DataView(epub.buffer, epub.byteOffset, epub.byteLength);
const expectedZipDate = ((2026 - 1980) << 9) | (8 << 5) | 30;
assert.equal(epubView.getUint16(10, true), 0, "ZIP time should follow the fixed EPUB modification time");
assert.equal(epubView.getUint16(12, true), expectedZipDate, "ZIP date should be reproducible across runs");
assert.throws(() => buildEpub(book, { modified: "not-a-date" }), /修改时间必须是有效日期/);
const entries = readStoredZip(epub);
const names = [...entries.keys()];
const decode = (name) => new TextDecoder().decode(entries.get(name));

assert.equal(names[0], "mimetype");
assert.equal(decode("mimetype"), "application/epub+zip");
assert.ok(entries.has("META-INF/container.xml"));
assert.ok(entries.has("EPUB/package.opf"));
assert.ok(entries.has("EPUB/nav.xhtml"));
assert.ok(entries.has("EPUB/styles/book.css"));
assert.ok(entries.has("EPUB/text/cover.xhtml"));
assert.ok(entries.has("EPUB/text/section-001.xhtml"));
// A cover image placed later in the book keeps its own page as well.
assert.ok(entries.has("EPUB/text/section-002.xhtml"));
assert.ok(entries.has("EPUB/images/image-2.png"));
assert.equal(Buffer.compare(Buffer.from(entries.get("EPUB/images/image-2.png")), Buffer.from(png)), 0);
assert.match(decode("EPUB/package.opf"), /properties="cover-image"/);
assert.match(decode("EPUB/package.opf"), /测试 &amp; 图文集/);
assert.match(decode("EPUB/text/section-001.xhtml"), /第一章 &lt;开始&gt;/);
assert.match(decode("EPUB/text/section-001.xhtml"), /<strong>粗体<\/strong>/);

// Plain text: one <p> per line, no Markdown, scene-break lines become <hr>.
assert.equal(
  plainTextToXhtml("　　第一段 **不是粗体** <b>\r\n\r\n  # 不是标题\n……\n- 不是列表\n"),
  "<p>第一段 **不是粗体** &lt;b&gt;</p>\n<p># 不是标题</p>\n<p>……</p>\n<p>- 不是列表</p>",
);
for (const marker of ["***", "* * *", "---", "◇◇◇", "◆◆◆", "＊＊＊", "＊　＊　＊", "◇"]) {
  assert.equal(plainTextToXhtml(`前\n${marker}\n后`), '<p>前</p>\n<hr class="scene-break" />\n<p>后</p>', marker);
}
assert.equal(plainTextToXhtml("——\n**"), "<p>——</p>\n<p>**</p>");
assert.equal(plainTextToXhtml("甲\u0001\n\u0001\n乙"), "<p>甲</p>\n<p>乙</p>");

// Text decoding: BOMs, strict UTF-8, then GB18030 for GBK files.
const utf8 = (text) => Array.from(new TextEncoder().encode(text));
assert.equal(decodeText(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4])), "中文");
assert.equal(
  decodeText(Uint8Array.from(Buffer.from("b5dad2bbd5c20d0ad6d0cec4a1a3a1b0bac3a1b1", "hex"))),
  "第一章\r\n中文。“好”",
);
assert.equal(decodeText(Uint8Array.from(utf8("中文 ok"))), "中文 ok");
assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("中文")])), "中文");
assert.equal(decodeText(Uint8Array.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65])), "中文");
assert.equal(decodeText(Uint8Array.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87])), "中文");
assert.equal(decodeText(new Uint8Array()), "");
assert.equal(decodeText("已是字符串"), "已是字符串");

const fixed = {
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000002",
  modified: "2026-08-30T00:00:00Z",
};
const unzipText = (data) => {
  const files = readStoredZip(data);
  return (name) => new TextDecoder().decode(files.get(name));
};

// Images are judged by content, kept without ids, and blank titles get defaults.
assert.equal(sniffImageType(png), "image/png");
assert.equal(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
assert.equal(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
assert.equal(sniffImageType(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')), "image/svg+xml");
assert.equal(sniffImageType(new TextEncoder().encode("BM....")), "");
assert.equal(mimeFromFilename("插图/01.JPG"), "image/jpeg");
{
  const mislabelled = buildEpub({
    title: "图片",
    coverItemId: "c",
    items: [
      { id: "c", type: "image", name: "a.jpg", mimeType: "image/jpeg", data: png },
      { type: "image", mimeType: "image/png", data: png },
      { type: "image", mimeType: "image/png", data: png },
      { type: "text", title: "  ", content: "x" },
    ],
  }, fixed);
  const read = unzipText(mislabelled);
  const opf = read("EPUB/package.opf");
  assert.match(opf, /<item id="image-1" href="images\/image-1.png" media-type="image\/png" properties="cover-image" \/>/);
  assert.match(opf, /<item id="image-2" href="images\/image-2.png"/);
  assert.match(opf, /<item id="image-3" href="images\/image-3.png"/);
  assert.match(read("EPUB/nav.xhtml"), /<a href="text\/section-004.xhtml">章节 4<\/a>/);
}
{
  // format: "plain" uses plain text; items without format stay Markdown.
  const read = unzipText(buildEpub({
    title: "格式",
    items: [
      { type: "text", title: "纯文本", format: "plain", content: "**原样**\n◇◇◇\n下一行" },
      { type: "text", title: "旧工程", content: "**粗体**" },
    ],
  }, fixed));
  assert.match(read("EPUB/text/section-001.xhtml"), /<p>\*\*原样\*\*<\/p>\n<hr class="scene-break" \/>\n<p>下一行<\/p>/);
  assert.match(read("EPUB/text/section-002.xhtml"), /<p><strong>粗体<\/strong><\/p>/);
}
{
  // toc: false leaves the nav; showTitle: false drops the <h1> but keeps <title>.
  const read = unzipText(buildEpub({
    title: "目录",
    items: [
      { type: "text", title: "第一章", content: "前半" },
      { type: "image", title: "插图", toc: false, mimeType: "image/png", data: png },
      { type: "text", title: "第一章（续）", toc: false, showTitle: false, content: "后半" },
    ],
  }, fixed));
  const nav = read("EPUB/nav.xhtml");
  assert.match(nav, /<ol><li><a href="text\/section-001.xhtml">第一章<\/a><\/li><\/ol>/);
  const continued = read("EPUB/text/section-003.xhtml");
  assert.match(continued, /<title>第一章（续）<\/title>/);
  assert.doesNotMatch(continued, /<h1>/);
  assert.match(read("EPUB/text/section-001.xhtml"), /<h1>第一章<\/h1>/);
}
{
  // Every item excluded: the first page is still listed.
  const read = unzipText(buildEpub({
    title: "空目录",
    items: [
      { type: "text", title: "甲", toc: false, content: "a" },
      { type: "text", title: "乙", toc: false, content: "b" },
    ],
  }, fixed));
  assert.match(read("EPUB/nav.xhtml"), /<ol><li><a href="text\/section-001.xhtml">甲<\/a><\/li><\/ol>/);
}
{
  // Cover image as the first item: only the cover page, and the nav points at it.
  const files = readStoredZip(buildEpub({
    title: "封面在前",
    coverItemId: "c",
    items: [
      { id: "c", type: "image", title: "", mimeType: "image/png", data: png },
      { id: "t", type: "text", title: "正文", content: "x" },
    ],
  }, fixed));
  const read = (name) => new TextDecoder().decode(files.get(name));
  assert.deepEqual([...files.keys()].filter((name) => name.startsWith("EPUB/text/")), [
    "EPUB/text/section-002.xhtml",
    "EPUB/text/cover.xhtml",
  ]);
  const opf = read("EPUB/package.opf");
  assert.doesNotMatch(opf, /id="page-1"/);
  assert.match(opf, /<spine>\n<itemref idref="cover-page" linear="yes" \/>\n<itemref idref="page-2" \/>\n<\/spine>/);
  assert.match(read("EPUB/nav.xhtml"), /<ol><li><a href="text\/cover.xhtml">封面<\/a><\/li>\n<li><a href="text\/section-002.xhtml">正文<\/a><\/li><\/ol>/);
}
{
  // paragraphIndent follows the language unless set; only body paragraphs are indented.
  const page = (book) => unzipText(buildEpub({
    title: "缩进",
    items: [{ type: "text", title: "章", content: "段落" }],
    ...book,
  }, fixed))("EPUB/text/section-001.xhtml");
  assert.match(page({ language: "zh-CN" }), /<article class="text-section indent">/);
  assert.match(page({ language: "ja" }), /<article class="text-section indent">/);
  assert.match(page({ language: "en" }), /<article class="text-section">/);
  assert.match(page({ language: "zh-TW", paragraphIndent: false }), /<article class="text-section">/);
  assert.match(page({ language: "en", paragraphIndent: true }), /<article class="text-section indent">/);
  assert.match(page({ language: "zha" }), /<article class="text-section">/);
  const css = unzipText(buildEpub({ title: "x", items: [{ type: "text", content: "x" }] }, fixed))("EPUB/styles/book.css");
  assert.match(css, /^\.indent > p \{ text-indent: 2em; \}$/m);
  assert.match(css, /^\.scene-break \{/m);
  assert.doesNotMatch(css, /^(p|h1|figcaption|nav[^{]*) \{[^}]*text-indent/m);
}
{
  // Translator is a contributor with the MARC "trl" role; no translator, no metadata.
  const opf = (book) => unzipText(buildEpub({ title: "译本", items: [{ type: "text", content: "x" }], ...book }, fixed))("EPUB/package.opf");
  const translated = opf({ author: "原作者", translator: " 译者 & 校对 " });
  assert.match(translated, /<dc:creator>原作者<\/dc:creator>/);
  assert.match(translated, /<dc:contributor id="translator">译者 &amp; 校对<\/dc:contributor>/);
  assert.match(translated, /<meta refines="#translator" property="role" scheme="marc:relators">trl<\/meta>/);
  assert.doesNotMatch(opf({ translator: "  " }), /translator/);
}
assert.deepEqual(
  validateBook({ title: "x", items: [{ type: "image", name: "a.bmp", mimeType: "image/jpeg", data: new TextEncoder().encode("BM....") }] }),
  ["不支持图片格式：a.bmp"],
);
assert.deepEqual(validateBook({ title: "x", language: "中文", items: [{ type: "text" }] }), ["语言代码无效：中文（例如 zh-CN、ja、en）"]);
for (const language of ["zh-CN", "zh-Hant-TW", "ja", "en", ""]) {
  assert.deepEqual(validateBook({ title: "x", language, items: [{ type: "text" }] }), [], language);
}
assert.deepEqual(
  validateBook({ title: "x", items: [{ type: "image", name: "空.png", mimeType: "image/png", data: new Uint8Array() }] }),
  ["图片没有数据：空.png"],
);

const sampleDirectory = path.resolve(__dirname, "../sample");
fs.mkdirSync(sampleDirectory, { recursive: true });
const samplePath = path.join(sampleDirectory, "验证样书.epub");
fs.writeFileSync(samplePath, epub);

// Command line: book.json with file paths -> EPUB. Also writes the CJK sample.
const cli = path.resolve(__dirname, "../cli.js");
const fixture = path.join(__dirname, "fixtures/novel/book.json");
const novelPath = path.join(sampleDirectory, "春天的约定.epub");
const run = (...args) => childProcess.spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
{
  const result = run(fixture, novelPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /已生成 .*春天的约定\.epub（5 项/);
  const novel = fs.readFileSync(novelPath);
  const again = buildEpub(...Object.values(loadBook(fixture)));
  assert.equal(Buffer.compare(novel, Buffer.from(again)), 0, "fixed identifier and modified give identical files");

  const files = readStoredZip(novel);
  const read = (name) => new TextDecoder().decode(files.get(name));
  const opf = read("EPUB/package.opf");
  // coverFile matches the first item: cover page only, no second copy.
  assert.ok(!files.has("EPUB/text/section-001.xhtml"));
  assert.match(opf, /<item id="image-1" href="images\/image-1.png" media-type="image\/png" properties="cover-image" \/>/);
  // illust-01.jpg is really a PNG.
  assert.match(opf, /<item id="image-3" href="images\/image-3.png" media-type="image\/png" \/>/);
  assert.match(opf, /<dc:identifier id="BookId">urn:uuid:00000000-0000-4000-8000-0000000000c1<\/dc:identifier>/);
  assert.match(opf, /<meta property="dcterms:modified">2026-10-10T00:00:00Z<\/meta>/);
  assert.match(opf, /<dc:contributor id="translator">译者甲<\/dc:contributor>/);
  assert.equal(
    read("EPUB/nav.xhtml").match(/<ol>[\s\S]*<\/ol>/)[0],
    '<ol><li><a href="text/cover.xhtml">封面</a></li>\n'
      + '<li><a href="text/section-002.xhtml">第一章 春天的约定</a></li>\n'
      + '<li><a href="text/section-005.xhtml">后记</a></li></ol>',
  );
  const first = read("EPUB/text/section-002.xhtml");
  assert.match(first, /<article class="text-section indent">\n<h1>第一章 春天的约定<\/h1>\n<p>四月的第一个星期，樱花还没有落完。<\/p>\n<p>“明天见。”她说完，转身跑进了雨里。<\/p>\n<p>……<\/p>/);
  assert.match(first, /<hr class="scene-break" \/>/);
  const continued = read("EPUB/text/section-004.xhtml");
  assert.match(continued, /<title>第一章 春天的约定（续）<\/title>/);
  assert.doesNotMatch(continued, /<h1>/);
  assert.match(continued, /<p>“这一段用 GBK 保存，导入时不应该变成乱码。”<\/p>\n<hr class="scene-break" \/>/);
  assert.match(read("EPUB/text/section-005.xhtml"), /<p>这一章用 <strong>Markdown<\/strong> 写成，换行处不会多出空格。<\/p>/);
}
{
  // A coverFile outside the items is put first, without a TOC entry.
  const directory = fs.mkdtempSync(path.join(sampleDirectory, ".cli-"));
  try {
    fs.copyFileSync(path.join(__dirname, "fixtures/novel/images/cover.png"), path.join(directory, "front.png"));
    const write = (config) => {
      fs.writeFileSync(path.join(directory, "book.json"), JSON.stringify(config));
      return path.join(directory, "book.json");
    };
    const { book } = loadBook(write({ title: "封面另放", coverFile: "front.png", items: [{ type: "text", content: "正文" }] }));
    assert.deepEqual(book.items.map((item) => [item.id, item.type, item.toc]), [["cover-file", "image", false], ["item-1", "text", undefined]]);
    assert.equal(book.coverItemId, "cover-file");
    assert.equal(book.items[1].format, undefined, "inline content stays Markdown");

    const missing = run(write({ title: "x", items: [{ type: "image", file: "nope.png" }] }), path.join(directory, "x.epub"));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /装订失败：第 1 项：读不到文件 nope.png/);
    assert.throws(() => loadBook(write({ title: "x", items: [{ id: "a", type: "text" }, { id: "a", type: "text" }] })), /id 重复：a/);
    assert.throws(() => loadBook(write({ title: "x", coverItemId: "nope", items: [{ type: "text" }] })), /coverItemId 没有对应的图片/);
    assert.equal(run().status, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

console.log(`PASS: ${names.length} ZIP entries validated`);
console.log(`SAMPLE: ${samplePath}`);
console.log(`SAMPLE: ${novelPath}`);

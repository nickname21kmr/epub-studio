const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildEpub,
  markdownToXhtml,
  mimeFromFilename,
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
  assert.equal(markdownToXhtml(`前文\n\n${rule}\n\n后文`), "<p>前文</p>\n<hr />\n<p>后文</p>");
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
assert.ok(entries.has("EPUB/images/image-2.png"));
assert.equal(Buffer.compare(Buffer.from(entries.get("EPUB/images/image-2.png")), Buffer.from(png)), 0);
assert.match(decode("EPUB/package.opf"), /properties="cover-image"/);
assert.match(decode("EPUB/package.opf"), /测试 &amp; 图文集/);
assert.match(decode("EPUB/text/section-001.xhtml"), /第一章 &lt;开始&gt;/);
assert.match(decode("EPUB/text/section-001.xhtml"), /<strong>粗体<\/strong>/);

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
assert.deepEqual(
  validateBook({ title: "x", items: [{ type: "image", name: "a.bmp", mimeType: "image/jpeg", data: new TextEncoder().encode("BM....") }] }),
  ["不支持图片格式：a.bmp"],
);
assert.deepEqual(
  validateBook({ title: "x", items: [{ type: "image", name: "空.png", mimeType: "image/png", data: new Uint8Array() }] }),
  ["图片没有数据：空.png"],
);

const sampleDirectory = path.resolve(__dirname, "../sample");
fs.mkdirSync(sampleDirectory, { recursive: true });
const samplePath = path.join(sampleDirectory, "验证样书.epub");
fs.writeFileSync(samplePath, epub);
console.log(`PASS: ${names.length} ZIP entries validated`);
console.log(`SAMPLE: ${samplePath}`);

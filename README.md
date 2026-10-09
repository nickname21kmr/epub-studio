# 页间 · 图文 EPUB 工坊

> **English overview** — A local-first, zero-dependency browser editor for combining TXT/Markdown and images into valid EPUB 3 books. It supports chapter ordering, captions and alt text, cover selection, project save/restore, plain-text chapters with CJK-friendly layout, and a small Node command-line build. Output is checked with EPUBCheck in CI. Content stays in the browser and is not uploaded.

一个零依赖、纯浏览器运行的 EPUB 3 制作工具。文本和图片都只在本机处理，不会上传到服务器。

## 立即使用

Windows 用户双击 `start.bat`，或直接用现代浏览器打开 `index.html`。

1. 填写书名、作者、译者、语言等信息。
2. 导入 `.txt` / `.md` 文本，或新建文字章节。
3. 导入 JPG、PNG、GIF、WEBP、SVG 图片。
4. 拖动左侧把手（或使用“上移 / 下移”）调整阅读顺序。
5. 为图片填写说明，并选择一张图片作为封面。
6. 点击“导出 EPUB”。

“保存工程”会生成 `.epubproj.json`，其中包含文字、元数据和图片。之后用“打开工程”即可继续编辑。

## 当前功能

- 输出 EPUB 3，包含标准 `mimetype`、container、OPF、导航目录、XHTML 和样式表。
- 每个文本或图片条目都是一个独立阅读页，可自由混排。
- 文字章节有两种格式：
  - Markdown：标题、段落、粗体、斜体、删除线、引用、列表、代码块、链接和分隔线。
  - 纯文本：每个非空行是一段，不解析任何标记；只由 `***`、`* * *`、`---`、`◇◇◇`、`◆◆◆`、`＊＊＊` 这类符号组成的行变成场景分隔。
- 导入 `.txt` 默认按纯文本处理，`.md` 按 Markdown。文本编码自动识别：带 BOM 的 UTF-8 / UTF-16、UTF-8、GBK / GB18030。
- 中文、日文换行：Markdown 段落里折行的两行之间不会多出空格。
- 中文、日文书默认段首缩进两字，可在“段首缩进”里关闭或对其他语言打开。
- 每个条目可以取消“列入目录”，文字章节可以取消“显示标题”。一章被插图分成几段时，后面几段可以都取消，目录里只留第一段。
- 封面图片如果就是第一个条目，只出现一次封面页，不会再重复一页。
- 图片按实际内容识别格式，扩展名写错（比如 WebP 存成 `.jpg`）也能正确声明。
- 工程保存与恢复；无需账户、网络或第三方库。同一本书反复导出时标识符不变，阅读器会当作同一本书更新。
- 适配桌面与窄屏浏览器，并包含基础键盘操作和图片替代文本入口。

## 命令行

需要 Node.js（CI 用的是 20），同样没有依赖：

```powershell
node cli.js book.json out.epub
npm run epub -- book.json out.epub
```

不写 `out.epub` 时按书名在当前目录生成。`book.json` 里的路径都相对于 `book.json` 所在目录：

```json
{
  "title": "书名",
  "author": "作者",
  "translator": "译者",
  "language": "zh-CN",
  "publisher": "",
  "description": "",
  "paragraphIndent": true,
  "identifier": "urn:uuid:……",
  "modified": "2026-10-10T00:00:00Z",
  "coverFile": "images/cover.jpg",
  "items": [
    { "type": "image", "file": "images/cover.jpg", "title": "封面" },
    { "type": "text", "title": "第一章", "file": "text/01.txt" },
    { "type": "image", "file": "images/01.jpg", "alt": "插图说明", "caption": "", "toc": false },
    { "type": "text", "title": "第一章（续）", "file": "text/01-2.txt", "toc": false, "showTitle": false },
    { "type": "text", "title": "后记", "content": "直接写在这里的正文按 Markdown 处理。" }
  ]
}
```

- 文字条目用 `file` 或 `content`。`file` 的编码自动识别；`.md` 按 Markdown，其他按纯文本。可以用 `"format": "plain"` 或 `"markdown"` 指定。
- 封面用 `coverFile`（图片路径）或 `coverItemId`（条目的 `id`）。`coverFile` 不在条目里时会放在最前面，不进目录。
- 写上 `identifier` 和 `modified` 后，同样的输入每次生成完全相同的文件。
- 完整例子在 `tests/fixtures/novel/`。

## 边界

- “结合”指把文字章节和图片页编排在同一本 EPUB 中，不是 OCR；图片里的文字不会被自动识别。
- 当前不直接解析 Word、PDF 或在线网页，请先另存为 TXT / Markdown。
- 文本编码只认 UTF-8、UTF-16（带 BOM）和 GBK / GB18030。Big5、Shift_JIS 的文件请先转成 UTF-8。
- 为保持零依赖，ZIP 条目使用标准的“不压缩存储”方式；照片本身通常已压缩，但输出文件不会再次压缩图片。
- 不同阅读器对 SVG、WEBP、GIF 动画和字体排版的支持可能不同。需要最高兼容性时优先使用 JPG / PNG。

## 项目结构

```text
epub-studio/
├─ index.html          # 界面
├─ styles.css          # 视觉与响应式样式
├─ app.js              # 导入、编排、工程保存和交互
├─ epub-core.js        # Markdown、纯文本、EPUB 和 ZIP 生成核心
├─ cli.js              # 命令行装订
├─ start.bat           # Windows 双击启动入口
├─ sample/             # 通过测试生成的 EPUB 样书
└─ tests/              # 核心与结构验证，fixtures/ 是命令行例子
```

## 开发验证

项目没有运行时依赖。安装 Node.js 与 Python 3 后，可以运行：

```powershell
node tests/test_core.js
python tests/validate_epub.py
```

第一条命令同时生成 `sample/验证样书.epub` 和 `sample/春天的约定.epub`（命令行例子：封面在前、纯文本、GBK 文本、插图分段、译者），并验证固定修改时间会产生完全相同的文件；第二条会用 Python 标准库打开 ZIP，解析所有 XML/XHTML 文件，并检查目录不为空、manifest 的 id 不重复、manifest 和 ZIP 内容一致。

CI 还会用 W3C 的 [EPUBCheck](https://github.com/w3c/epubcheck) 5.4.0 检查这两本样书，有任何错误或警告都算失败。本地运行需要 Java（CI 用的是 Temurin 17）：

```powershell
java -jar epubcheck.jar --failonwarnings sample/春天的约定.epub
```

# 页间 · 图文 EPUB 工坊

一个零依赖、纯浏览器运行的 EPUB 3 制作工具。文本和图片都只在本机处理，不会上传到服务器。

## 立即使用

Windows 用户双击 `start.bat`，或直接用现代浏览器打开 `index.html`。

1. 填写书名、作者、语言等信息。
2. 导入 `.txt` / `.md` 文本，或新建文字章节。
3. 导入 JPG、PNG、GIF、WEBP、SVG 图片。
4. 拖动左侧把手（或使用“上移 / 下移”）调整阅读顺序。
5. 为图片填写说明，并选择一张图片作为封面。
6. 点击“导出 EPUB”。

“保存工程”会生成 `.epubproj.json`，其中包含文字、元数据和图片。之后用“打开工程”即可继续编辑。

## 当前功能

- 输出 EPUB 3，包含标准 `mimetype`、container、OPF、导航目录、XHTML 和样式表。
- 每个文本或图片条目都是一个独立阅读页，可自由混排。
- 基础 Markdown：标题、段落、粗体、斜体、删除线、引用、列表、代码块、链接和分隔线。
- 封面图片与 EPUB 目录自动生成。
- 工程保存与恢复；无需账户、网络或第三方库。
- 适配桌面与窄屏浏览器，并包含基础键盘操作和图片替代文本入口。

## 边界

- “结合”指把文字章节和图片页编排在同一本 EPUB 中，不是 OCR；图片里的文字不会被自动识别。
- 当前不直接解析 Word、PDF 或在线网页，请先另存为 TXT / Markdown。
- 为保持零依赖，ZIP 条目使用标准的“不压缩存储”方式；照片本身通常已压缩，但输出文件不会再次压缩图片。
- 不同阅读器对 SVG、WEBP、GIF 动画和字体排版的支持可能不同。需要最高兼容性时优先使用 JPG / PNG。

## 项目结构

```text
epub-studio/
├─ index.html          # 界面
├─ styles.css          # 视觉与响应式样式
├─ app.js              # 导入、编排、工程保存和交互
├─ epub-core.js        # Markdown、EPUB 和 ZIP 生成核心
├─ start.bat           # Windows 双击启动入口
├─ sample/             # 通过测试生成的 EPUB 样书
└─ tests/              # 核心与结构验证
```

## 开发验证

项目没有运行时依赖。安装 Node.js 与 Python 3 后，可以运行：

```powershell
node tests/test_core.js
python tests/validate_epub.py
```

第一条命令同时生成 `sample/验证样书.epub`；第二条会用 Python 标准库打开 ZIP，并解析所有 XML/XHTML 文件。

# Soul Mark

一个面向桌面的 Markdown 编辑器，基于 Tauri v2 + React 19 + Milkdown 构建。
原生窗口融合（macOS 红绿灯集成）、毛玻璃主题、多标签页、自动保存，以及代码高亮、数学公式、Mermaid 图表等富 Markdown 能力。

## 功能特性

- **所见即所得编辑**：基于 Milkdown（ProseMirror）的富文本 Markdown 编辑，支持 GFM（表格、任务列表、删除线等）。
- **富内容渲染**：Shiki 代码高亮（明暗主题跟随）、KaTeX 数学公式、Mermaid 图表、行内 HTML 块。
- **多标签页**：同时打开多个文件，标签间独立编辑状态与光标位置；切换标签不串内容。
- **自动保存**：输入后防抖（1.5s）自动写盘，并以 doc 引用比较（O(1)）检测写盘期间是否有新输入，避免大文档二次序列化开销。
- **文件树与搜索**：侧栏文件树（自动过滤无 `.md` 的空目录、跳过 `node_modules` 等大目录），`⌘K` 即时搜索文件名（按 fsVersion 缓存失效）。
- **大纲面板**：实时解析文档标题层级，点击跳转（遵循 `prefers-reduced-motion`）。
- **选区浮动工具栏**：类 Notion 选区工具栏，支持标题级别、加粗/斜体/删除线、代码、链接等快捷操作。
- **主题系统**：浅色/暗色双主题，借助 CSS `@property` 注册颜色变量实现主题切换的颜色平滑插值；支持自定义背景图 + 毛玻璃分层。
- **原生窗口集成**：macOS `titleBarStyle: Overlay` + 红绿灯避让；Windows 自定义窗口控制按钮。
- **安全删除**：删除操作走 Rust `safe_remove` 命令，路径规范化 + 家目录/根目录保护，前端永不直接接触裸 `fs` 删除。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Tauri v2（Rust 后端） |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 7 |
| 编辑器内核 | Milkdown 7（@milkdown/kit, @milkdown/react） |
| 代码高亮 | Shiki 4 |
| 数学渲染 | KaTeX 0.18 |
| 图表 | Mermaid 11 |
| 包管理 | pnpm |

## 项目结构

```
src/
├── App.tsx                      # 应用根：布局、Tab 管理、全局协调
├── components/
│   ├── Editor.tsx               # Milkdown 编辑器封装（getMarkdown/setMarkdown/getDocVersion 等）
│   ├── SelectionToolbar.tsx     # 选区浮动工具栏
│   ├── Sidebar.tsx              # 侧栏：搜索 + 文件树
│   ├── TreeNode.tsx             # 文件树递归节点
│   ├── Outline.tsx              # 大纲面板
│   ├── SourceView.tsx           # Markdown 源码视图
│   ├── SettingsModal.tsx        # 设置弹窗
│   ├── ContextMenu.tsx         # 右键菜单
│   ├── FloatingBall.tsx         # 悬浮球
│   ├── SleepingCat.tsx          # 待机猫咪动画
│   └── ...
├── hooks/
│   ├── useFile.ts               # 文件读写、Tab、自动保存
│   ├── useFileTree.ts           # 目录读取、搜索（带 fsVersion 缓存）
│   ├── useSettings.ts          # 主题/背景图等设置持久化
│   ├── useOutline.ts           # 大纲解析
│   ├── useKeyboardShortcuts.ts # 全局快捷键
│   └── ...
├── services/
│   ├── fs.ts                    # Tauri FS 封装
│   └── background.ts           # 背景图加载
├── utils/
│   ├── sanitize.ts             # HTML 白名单 / URL 协议清理
│   ├── scroll.ts               # 平滑滚动（尊重 reduced-motion）
│   ├── path.ts                 # 路径工具
│   └── platform.ts            # 平台判断
└── styles/editor.css           # 编辑器样式

src-tauri/src/
└── lib.rs                      # Rust 命令：safe_remove / opened_files
```

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `⌘/Ctrl + S` | 保存 |
| `⌘/Ctrl + Shift + S` | 另存为 |
| `⌘/Ctrl + O` | 打开文件 |
| `⌘/Ctrl + N` | 新建文件 |
| `⌘/Ctrl + W` | 关闭当前标签 |
| `⌘/Ctrl + K` | 聚焦文件搜索 |
| `Esc` | 关闭弹窗 / 清空搜索 |

## 安全设计

- **CSP**：`script-src 'self'`，禁止内联脚本；`object-src 'none'`、`frame-src 'none'` 收窄攻击面。
- **HTML 清理**：原始 HTML 块经 `sanitizeHtml` 白名单过滤，剥离 `on*` 事件与危险协议。
- **URL 协议清理**：链接与图片 `src` 经 `sanitizeUrl`，剥离 `javascript:` 等危险协议。
- **安全删除**：`safe_remove` 在 Rust 侧规范化路径并拒绝家目录/根目录删除，前端无法绕过。

## 开发与构建

环境要求：[Node.js](https://nodejs.org/)、[pnpm](https://pnpm.io/)、[Rust](https://www.rust-lang.org/) 及 [Tauri v2 前置依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
# 安装依赖
pnpm install

# 开发模式（启动 Tauri 开发窗口）
pnpm tauri dev

# 构建生产包（TypeScript 检查 + Vite 构建 + Rust 编译）
pnpm tauri build
```

仅前端开发调试（不启动桌面窗口）：

```bash
pnpm dev      # Vite 开发服务器
pnpm build    # 产物输出到 dist/
```

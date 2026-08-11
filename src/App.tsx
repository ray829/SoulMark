import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownEditor, type EditorHandle } from "./components/Editor";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { WindowControls } from "./components/WindowControls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useFile } from "./hooks/useFile";
import { baseName } from "./utils/path";
import "./App.css";

/* Windows 平台检测:用于自绘窗口控制按钮(UA 判断,纯 UI 用途) */
const isWindows =
  typeof navigator !== "undefined" && /Windows NT/.test(navigator.userAgent);

/* ===== 内联 SVG 图标(无新增依赖,统一 stroke 风格) ===== */
type IconProps = { className?: string };

function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 关闭文件 */
function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** 文件图标 */
function FileMarkdown({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 16V8l3 4 3-4v8" />
    </svg>
  );
}

/** 侧边栏收起/展开图标 */
function PanelLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

/* 侧栏宽度范围 */
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 320;

function App() {
  const editorRef = useRef<EditorHandle>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  // 侧栏宽度：写入 --sidebar-w CSS 变量，side bar / 标签对齐共同跟随
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const sidebarWidthRef = useRef(264);
  sidebarWidthRef.current = sidebarWidth;
  // 侧栏收起/展开：收起时有效宽度为 0，保留内部展开状态不卸载
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const effectiveSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;

  // 图片放大预览状态（点击编辑区内图片触发）
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  // 编辑区容器 ref：代码块增强（语言标签/复制按钮）需在其外层操作
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击编辑区内图片：打开放大预览
  const onEditorClick = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const img = t.closest?.("img") as HTMLImageElement | null;
    if (img && img.src) setPreview({ src: img.src, alt: img.alt });
  }, []);

  // 顶部标签偏移：展开时对齐内容区左边缘(sidebar+16)；
  // mac 收起时贴近展开按钮右侧(mac 按钮右缘约108),win 收起时避开左侧展开按钮
  const tabsMarginLeft = sidebarCollapsed
    ? isWindows
      ? 48
      : 118
    : sidebarWidth + 16;

  // 分隔条拖拽调整侧栏宽度，限制在 [SIDEBAR_MIN, SIDEBAR_MAX]
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 从收起态拖动时先展开，再以记录的宽度继续调整
    setSidebarCollapsed(false);
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const resizer = e.currentTarget;
    resizer.classList.add("dragging");
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      resizer.classList.remove("dragging");
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const {
    currentPath,
    dirty,
    rootDir,
    fsVersion,
    openFile,
    openFolder,
    openByPath,
    saveFile,
    saveAsFile,
    newFile,
    closeFile,
    deletePath,
    renamePath,
    createFileIn,
    createDirIn,
    onMdChange,
  } = useFile(editorRef);

  // 快捷键:Cmd/Ctrl+S 保存、+Shift 另存为、+O 打开、+N 新建
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) void saveAsFile();
        else void saveFile();
      } else if (k === "o") {
        e.preventDefault();
        void openFile();
      } else if (k === "n") {
        e.preventDefault();
        newFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveFile, saveAsFile, openFile, newFile]);

  const closeCtx = useCallback(() => setCtxMenu(null), []);
  const onContext = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // 编辑器空白区右键:保存 / 另存为。内容区(ProseMirror)内不拦截,保留浏览器粘贴/复制。
  // 欢迎页(.welcome)内也不拦截,避免空态下弹无意义的"保存/另存为"。
  const onEditorContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".ProseMirror")) return;
      if (target.closest(".welcome")) return;
      const items: MenuItem[] = [
        { key: "save", label: "保存", onClick: () => void saveFile() },
        { key: "saveas", label: "另存为…", onClick: () => void saveAsFile() },
      ];
      onContext(e, items);
    },
    [onContext, saveFile, saveAsFile],
  );

  const onEditorMouseDown = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.isContentEditable) return;
    // 欢迎页内的点击(按钮等)交由原生处理,不抢焦点、不 preventDefault
    if (t.closest(".welcome")) return;
    e.preventDefault();
    editorRef.current?.focusEditor();
  }, [editorRef]);

  // 有文件才显示文件名;无文件时不显示任何文字(保持标题栏干净)
  const fileName = currentPath ? baseName(currentPath) : "";
  // 有文件或未保存改动时才显示关闭按钮
  const canClose = currentPath !== null || dirty;

  return (
    <div
      className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      style={
        {
          "--sidebar-w": `${effectiveSidebarWidth}px`,
          "--tabs-ml": `${tabsMarginLeft}px`,
        } as React.CSSProperties
      }
    >
      {/* 顶部栏:窗口控件占位 + 拖拽区 + 当前文件标签 + 新建按钮 */}
      <header className="topbar">
        <div className="topbar-drag" data-tauri-drag-region="" />
        {/* 收起/展开侧边栏按钮:mac 挨着红绿灯、win 放最左,统一置于顶栏最左侧 */}
        <button
          className={`topbar-toggle-sidebar${isWindows ? "" : " mac"}`}
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          <PanelLeftIcon className={sidebarCollapsed ? "flipped" : ""} />
        </button>
        <div className="topbar-tabs">
          <div className="topbar-tab" title={currentPath ?? "编辑器"}>
            {fileName || "Soul Mark"}
          </div>
          <button
            className="topbar-tab-add"
            onClick={newFile}
            title="新建文件"
            aria-label="新建文件"
          >
            <PlusIcon />
          </button>
        </div>
        {/* Windows 下自绘窗口控制按钮(macOS 用原生红绿灯,不渲染) */}
        {isWindows && <WindowControls />}
      </header>

      <div className="app-body">
        {/* 左侧导航/文件树侧栏 */}
        <Sidebar
          rootDir={rootDir}
          currentPath={currentPath}
          fsVersion={fsVersion}
          onSelect={openByPath}
          onOpenFolder={openFolder}
          onOpenFile={openFile}
          onNewFile={newFile}
          onContext={onContext}
          onDelete={deletePath}
          onRename={renamePath}
          onCreateFile={createFileIn}
          onCreateDir={createDirIn}
        />

        {/* 主内容区:白色圆角卡片 */}
        <main className="main-content">
          {/* 分隔条:绑定内容区左侧边框,拖动调整侧栏宽度(收起时不渲染,避免点击误展开) */}
          {!sidebarCollapsed && (
            <div
              className="sidebar-resizer"
              onMouseDown={onResizeStart}
              title="拖动调整侧栏宽度"
            />
          )}
          <div className="editor-header">
            <div className="editor-title">
              <FileMarkdown className="editor-title-icon" />
              {dirty && (
                <span className="dirty-dot" title="未保存的修改">
                  ●
                </span>
              )}
              <span className="file-name" title={currentPath ?? ""}>
                {fileName || "未打开文件"}
              </span>
            </div>
            {canClose && (
              <button
                className="editor-close"
                onClick={() => void closeFile()}
                title="关闭文件"
                aria-label="关闭文件"
              >
                <CloseIcon />
              </button>
            )}
          </div>
          <div
            ref={wrapRef}
            className="editor-wrap"
            onContextMenu={onEditorContextMenu}
            onMouseDown={onEditorMouseDown}
            onClick={onEditorClick}
          >
            <ErrorBoundary>
              <MarkdownEditor ref={editorRef} onChange={onMdChange} />
            </ErrorBoundary>
            {/* 无文件且无未保存改动时显示欢迎页(覆盖层) */}
            {currentPath === null && !dirty && (
              <Welcome onOpenFile={() => void openFile()} onOpenFolder={() => void openFolder()} />
            )}
          </div>
        </main>
      </div>

      <ContextMenu
        position={ctxMenu ? { x: ctxMenu.x, y: ctxMenu.y } : null}
        items={ctxMenu?.items ?? []}
        onClose={closeCtx}
      />

      {/* 图片放大预览层 */}
      {preview && (
        <div className="img-lightbox" onClick={() => setPreview(null)}>
          <img src={preview.src} alt={preview.alt} />
        </div>
      )}
    </div>
  );
}

export default App;

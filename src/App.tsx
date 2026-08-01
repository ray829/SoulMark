import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownEditor, type EditorHandle } from "./components/Editor";
import { Sidebar } from "./components/Sidebar";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { useFile } from "./hooks/useFile";
import { baseName } from "./utils/path";
import "./App.css";

/* ===== 内联 SVG 图标(无新增依赖,统一 stroke 风格) ===== */
type IconProps = { className?: string };

/** 侧栏收展按钮:ChevronRight,展开态旋转 180° 变朝左(收起)。
 *  收起态 ▶ = 点击展开;展开态 ◀ = 点击收起。 */
function ChevronRight({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
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

function App() {
  const editorRef = useRef<EditorHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
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

  // 编辑器空白区右键:保存 / 另存为。内容区(ProseMirror)内不拦截,保留浏览器粘贴/复制
  const onEditorContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".ProseMirror")) return;
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
    e.preventDefault();
    editorRef.current?.focusEditor();
  }, [editorRef]);

  const fileName = currentPath ? baseName(currentPath) : "未命名";
  // 有文件或未保存改动时才显示关闭按钮
  const canClose = currentPath !== null || dirty;

  return (
    <div className="app">
      <div className={`sidebar-wrap${sidebarOpen ? "" : " collapsed"}`}>
        <div className="sidebar-clip">
          <Sidebar
            rootDir={rootDir}
            currentPath={currentPath}
            fsVersion={fsVersion}
            onSelect={openByPath}
            onOpenFolder={openFolder}
            onOpenFile={openFile}
            onContext={onContext}
            onDelete={deletePath}
            onRename={renamePath}
            onCreateFile={createFileIn}
            onCreateDir={createDirIn}
          />
        </div>
        <button
          className={`sidebar-toggle${sidebarOpen ? " is-open" : ""}`}
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "收起文件树" : "展开文件树"}
          aria-label="切换文件树"
          aria-expanded={sidebarOpen}
        >
          <ChevronRight />
        </button>
      </div>
      <div className="editor-col">
        <div className="editor-header">
          <div className="drag-region" data-tauri-drag-region="" />
          <div className="editor-title">
            {dirty && (
              <span className="dirty-dot" title="未保存的修改">
                ●
              </span>
            )}
            <span className="file-name" title={currentPath ?? "未命名"}>
              {fileName}
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
        <main
          className="editor-wrap"
          onContextMenu={onEditorContextMenu}
          onMouseDown={onEditorMouseDown}
        >
          <MarkdownEditor ref={editorRef} onChange={onMdChange} />
        </main>
      </div>
      <ContextMenu
        position={ctxMenu ? { x: ctxMenu.x, y: ctxMenu.y } : null}
        items={ctxMenu?.items ?? []}
        onClose={closeCtx}
      />
    </div>
  );
}

export default App;

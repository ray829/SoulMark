import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownEditor, type EditorHandle } from "./components/Editor";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { WindowControls } from "./components/WindowControls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CloseIcon, FileMarkdown, PanelLeftIcon, PlusIcon } from "./components/icons";
import { useFile } from "./hooks/useFile";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { isWindows } from "./utils/platform";
import { baseName } from "./utils/path";
import "./App.css";

function App() {
  const editorRef = useRef<EditorHandle>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  // 图片放大预览状态(点击编辑区内图片触发)
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  // 编辑区容器 ref:代码块增强(语言标签/复制按钮)需在其外层操作
  const wrapRef = useRef<HTMLDivElement>(null);

  const {
    sidebarWidth,
    sidebarCollapsed,
    effectiveWidth: effectiveSidebarWidth,
    setSidebarCollapsed,
    onResizeStart,
  } = useSidebarResize();

  const {
    tabs,
    activeTabId,
    activeTab,
    openPaths,
    switchTab,
    closeTab,
    closeOthers,
    closeRight,
    moveTab,
    currentPath,
    dirty,
    rootDir,
    fsVersion,
    fsChange,
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
    pendingRename,
    clearPendingRename,
  } = useFile(editorRef, wrapRef);

  // 快捷键:Cmd/Ctrl+S 保存、+Shift 另存为、+O 打开、+N 新建
  useKeyboardShortcuts({
    save: () => void saveFile(),
    saveAs: () => void saveAsFile(),
    open: () => void openFile(),
    newFile,
    close: () => void closeFile(),
  });

  // 顶部标签偏移:展开时对齐内容区左边缘(sidebar+16);
  // mac 收起时贴近展开按钮右侧(mac 按钮右缘约108),win 收起时避开左侧展开按钮
  const tabsMarginLeft = sidebarCollapsed
    ? isWindows
      ? 48
      : 118
    : sidebarWidth + 16;

  // 点击编辑区内图片:打开放大预览
  const onEditorClick = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const img = t.closest?.("img") as HTMLImageElement | null;
    if (img && img.src) setPreview({ src: img.src, alt: img.alt });
  }, []);

  const closeCtx = useCallback(() => setCtxMenu(null), []);
  const onContext = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // 标签右键菜单:关闭 / 关闭其他 / 关闭右侧
  const onTabContext = useCallback(
    (e: React.MouseEvent, tabId: number) => {
      e.preventDefault();
      const items: MenuItem[] = [
        { key: "close", label: "关闭", onClick: () => void closeTab(tabId) },
        { key: "close-others", label: "关闭其他", onClick: () => void closeOthers(tabId) },
        { key: "close-right", label: "关闭右侧", onClick: () => void closeRight(tabId) },
      ];
      onContext(e, items);
    },
    [onContext, closeTab, closeOthers, closeRight],
  );

  // 标签拖拽排序(HTML5 draggable):点击 vs 拖拽由浏览器/OS 系统级判定,
  // Mac 触控板长按不动不触发 dragstart,只有按住+持续移动才触发——从根源消除误触。
  // 前提:Tauri 默认 dragDropEnabled 会拦截 webview 内 DnD,已在 tauri.conf.json 禁用。
  const dragTabId = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dragOverPlace, setDragOverPlace] = useState<"before" | "after">("before");
  // 拖拽态用 ref 跟踪,setState 仅用于视觉反馈
  const overIdRef = useRef<number | null>(null);
  const overPlaceRef = useRef<"before" | "after">("before");

  const onTabDragStart = useCallback((e: React.DragEvent, tabId: number) => {
    dragTabId.current = tabId;
    setDraggingId(tabId);
    e.dataTransfer.effectAllowed = "move";
    // setData 在部分 webview 是触发后续 dragover/drop 的必要条件
    e.dataTransfer.setData("text/plain", String(tabId));
  }, []);

  const onTabDragOver = useCallback((e: React.DragEvent, tabId: number) => {
    e.preventDefault(); // 必需,否则 drop 不触发
    e.dataTransfer.dropEffect = "move";
    if (dragTabId.current == null || dragTabId.current === tabId) {
      if (overIdRef.current !== null) {
        overIdRef.current = null;
        setDragOverId(null);
      }
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const place: "before" | "after" =
      e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    if (overIdRef.current !== tabId || overPlaceRef.current !== place) {
      overIdRef.current = tabId;
      overPlaceRef.current = place;
      setDragOverId(tabId);
      setDragOverPlace(place);
    }
  }, []);

  const onTabDragLeave = useCallback((tabId: number) => {
    if (overIdRef.current === tabId) {
      overIdRef.current = null;
      setDragOverId(null);
    }
  }, []);

  const onTabDrop = useCallback(
    (e: React.DragEvent, targetId: number) => {
      e.preventDefault();
      const fromId = dragTabId.current;
      const place = overPlaceRef.current;
      dragTabId.current = null;
      overIdRef.current = null;
      setDragOverId(null);
      setDraggingId(null);
      if (fromId == null || fromId === targetId) return;
      moveTab(fromId, targetId, place);
    },
    [moveTab],
  );

  const onTabDragEnd = useCallback(() => {
    dragTabId.current = null;
    overIdRef.current = null;
    setDragOverId(null);
    setDraggingId(null);
  }, []);

  // 标签栏横向滚动:鼠标滚轮(垂直 deltaY)转横向 + 溢出时两端箭头
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < max - 1);
  }, []);

  // 鼠标滚轮:垂直 deltaY 转横向 scrollLeft(横向 deltaX 走原生,不干预触控板双指横滑)
  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 滚动 / 容器尺寸变化时更新箭头显隐
  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(el);
    updateScrollState();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [updateScrollState]);

  // tab 增删后内容宽度变化,延迟一帧让 DOM 更新后重算
  useEffect(() => {
    requestAnimationFrame(updateScrollState);
  }, [tabs.length, updateScrollState]);

  // 激活的 tab 滚进可视区:新建/切换 tab 时,若它在溢出区外则滚动它可见。
  // nearest:仅在必要时滚动,已可见的不动,不干扰用户手动滚动位置。
  useEffect(() => {
    if (activeTabId == null) return;
    const el = tabsScrollRef.current?.querySelector<HTMLElement>(
      `.topbar-tab[data-tab-id="${activeTabId}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  // 箭头点击:平滑滚动约一个大 tab 宽度
  const scrollTabs = useCallback((dir: 1 | -1) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
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
  // 有 tab 就允许关闭当前(editor-header 的关闭按钮)
  const canClose = activeTabId !== null;

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
        <div className="topbar-tabs-wrap">
          <div className="topbar-tabs" ref={tabsScrollRef}>
            {tabs.map((tab) => {
              const isDragging = draggingId === tab.id;
              const isOver = dragOverId === tab.id;
              return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={`topbar-tab${tab.id === activeTabId ? " active" : ""}${isDragging ? " dragging" : ""}${isOver ? ` drag-over-${dragOverPlace}` : ""}`}
                title={tab.path ?? "未命名"}
                draggable
                onDragStart={(e) => onTabDragStart(e, tab.id)}
                onDragOver={(e) => onTabDragOver(e, tab.id)}
                onDragLeave={() => onTabDragLeave(tab.id)}
                onDrop={(e) => onTabDrop(e, tab.id)}
                onDragEnd={onTabDragEnd}
                onClick={() => switchTab(tab.id)}
                onContextMenu={(e) => onTabContext(e, tab.id)}
                onAuxClick={(e) => {
                  // 中键关闭
                  if (e.button === 1) {
                    e.preventDefault();
                    void closeTab(tab.id);
                  }
                }}
              >
                <span className="topbar-tab-name">
                  {tab.path ? baseName(tab.path) : "未命名"}
                </span>
                {tab.dirty && (
                  <span className="topbar-tab-dirty" title="未保存的修改">
                    ●
                  </span>
                )}
                <button
                  className="topbar-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTab(tab.id);
                  }}
                  title="关闭标签"
                  aria-label="关闭标签"
                >
                  <CloseIcon />
                </button>
              </div>
              );
            })}
          </div>
          {canScrollLeft && (
            <button
              className="tab-scroll-btn left"
              onClick={() => scrollTabs(-1)}
              title="向左滚动"
              aria-label="向左滚动"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3.5L5.5 8l4.5 4.5" />
              </svg>
            </button>
          )}
          {canScrollRight && (
            <button
              className="tab-scroll-btn right"
              onClick={() => scrollTabs(1)}
              title="向右滚动"
              aria-label="向右滚动"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3.5l4.5 4.5-4.5 4.5" />
              </svg>
            </button>
          )}
        </div>
        <button
          className="topbar-tab-add"
          onClick={newFile}
          title="新建文件"
          aria-label="新建文件"
        >
          <PlusIcon />
        </button>
        {/* Windows 下自绘窗口控制按钮(macOS 用原生红绿灯,不渲染) */}
        {isWindows && <WindowControls />}
      </header>

      <div className="app-body">
        {/* 左侧导航/文件树侧栏 */}
        <Sidebar
          rootDir={rootDir}
          openPaths={openPaths}
          fsVersion={fsVersion}
          fsChange={fsChange}
          pendingRename={pendingRename}
          onRenameDone={clearPendingRename}
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
            {/* 无 tab,或当前为空白未命名未改时显示欢迎页(覆盖层) */}
            {(!activeTabId || (activeTab?.path === null && !activeTab.dirty)) && (
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

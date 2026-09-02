import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MarkdownEditor, type EditorHandle } from "./components/Editor";
import { Outline } from "./components/Outline";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { WindowControls } from "./components/WindowControls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FloatingBall } from "./components/FloatingBall";
import { SettingsModal } from "./components/SettingsModal";
import { ThemeToggleButton } from "./components/ThemeToggleButton";
import { CloseIcon, FileMarkdown, PanelLeftIcon, PlusIcon } from "./components/icons";
import { useFile } from "./hooks/useFile";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSettings } from "./hooks/useSettings";
import { useTrafficLightInset } from "./hooks/useTrafficLightInset";
import { setShikiTheme } from "./components/editor-views/ShikiHighlightPlugin";
import { setMermaidTheme } from "./components/editor-views/MermaidView";
import { SourceView, type SourceViewHandle } from "./components/SourceView";
import { isWindows } from "./utils/platform";
import { baseName } from "./utils/path";
import { smoothScrollBy, smoothScrollTo } from "./utils/scroll";
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

  // 阅读偏好:主题/字号/源码模式/背景图/毛玻璃(localStorage 持久化)
  const {
    theme,
    fontSize,
    sourceMode,
    bgImage,
    bgBlur,
    bgDim,
    glassBlur,
    glassOpacity,
    setBgImage,
    setBgBlur,
    setBgDim,
    setGlassBlur,
    setGlassOpacity,
    resetBackground,
    toggleTheme,
    cycleFontSize,
    toggleSourceMode: toggleSourceModeRaw,
  } = useSettings();

  // macOS 红绿灯避让:写 --traffic-left(非 mac/全屏时为 0),供顶栏各元素偏移引用。
  useTrafficLightInset();

  // 外观设置弹窗显隐(悬浮球「外观设置」入口)
  const [bgSettingsOpen, setBgSettingsOpen] = useState(false);

  // 源码模式:SourceView ref(供 flushSource 调 flush) + editor 就绪标志
  // (冷启动持久化源码模式时,需等 Milkdown ready 再挂 SourceView,避免 getMarkdown 返回空)
  const sourceViewRef = useRef<SourceViewHandle>(null);
  const [editorReady, setEditorReady] = useState(false);
  // 源码模式内容同步:切 tab/保存前由 useFile 调用,把 textarea 内容写回 Milkdown
  const flushSource = useCallback(() => {
    if (sourceMode) sourceViewRef.current?.flush();
  }, [sourceMode]);

  // 源码模式滚动比例:toggle 前同步捕获/恢复,绕过 CSS 隐藏 Milkdown 导致
  // .editor-wrap 滚动位置塌缩的时序问题(切到 source-mode 后 wrap.scrollHeight
  // 立即塌缩,useEffect 读到的 scrollTop 已是 0)。
  // - 进入源码:toggle 前(此时 sourceMode=false)从 wrap 读比例存 ref,
  //   SourceView mount 后按比例设 textarea.scrollTop
  // - 退出源码:toggle 前(此时 sourceMode=true)从 textarea 读比例存 ref,
  //   unmount cleanup 后按比例设 wrap.scrollTop
  const pendingScrollRatio = useRef(0);
  const toggleSourceMode = useCallback(() => {
    // toggle 前捕获当前滚动比例(sourceMode 是切换前的值)
    if (!sourceMode) {
      // 即将进入源码:读 wrap 比例(此时 Milkdown 仍在,scrollHeight 未塌缩)
      const wrap = wrapRef.current;
      if (wrap) {
        const max = wrap.scrollHeight - wrap.clientHeight;
        pendingScrollRatio.current = max > 0 ? wrap.scrollTop / max : 0;
      }
    }
    // 即将退出源码:SourceView 自身的 onScroll 已持续更新 ref,无需捕获
    toggleSourceModeRaw();
  }, [sourceMode, toggleSourceModeRaw]);

  // 主题变化:联动 Shiki 代码高亮 + Mermaid 图表主题
  useEffect(() => {
    const onThemeChange = (e: Event) => {
      const resolved = (e as CustomEvent<"light" | "dark">).detail;
      setShikiTheme(resolved);
      setMermaidTheme(resolved);
    };
    window.addEventListener("soulmark:theme-change", onThemeChange);
    // 初始:同步一次当前 data-theme(useSettings 已写入 DOM)
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "light") {
      setShikiTheme(current);
      setMermaidTheme(current);
    }
    return () => window.removeEventListener("soulmark:theme-change", onThemeChange);
  }, []);

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
  } = useFile(editorRef, wrapRef, flushSource);

  // 快捷键:Cmd/Ctrl+S 保存、+Shift 另存为、+O 打开、+N 新建
  useKeyboardShortcuts({
    save: () => void saveFile(),
    saveAs: () => void saveAsFile(),
    open: () => void openFile(),
    newFile,
    close: () => void closeFile(),
  });


  // 双击 .md 用本应用打开:监听系统投递的文件路径,editor 就绪后调用 openByPath。
  // 冷启动:Rust setup 已把路径存入 PendingFiles,此处 invoke 拉取;此时 editor 可能未就绪 → 暂存。
  // 热启动:应用已运行,listen 收到 emit。两种都等 editor ready 才消费。
  // openByPath 已自带去重与"无 rootDir 时以文件所在目录为根"逻辑,契合双击任意位置文件。
  const editorReadyRef = useRef(false);
  const pendingOpenRef = useRef<string[]>([]);
  const consumeOpenFiles = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      if (editorReadyRef.current) {
        for (const p of paths) void openByPath(p);
      } else {
        pendingOpenRef.current.push(...paths);
      }
    },
    [openByPath],
  );
  const onEditorReady = useCallback(() => {
    editorReadyRef.current = true;
    setEditorReady(true);
    const pending = pendingOpenRef.current;
    if (pending.length > 0) {
      pendingOpenRef.current = [];
      for (const p of pending) void openByPath(p);
    }
  }, [openByPath]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    invoke<string[]>("opened_files")
      .then(consumeOpenFiles)
      .catch(() => {});
    listen<string[]>("opened-files", (e) => consumeOpenFiles(e.payload))
      .then((u) => {
        // 竞态保护:卸载先于 listen resolve 时,unlisten 仍 undefined → cleanup 漏清理 → 泄漏。
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [consumeOpenFiles]);

  // 顶部标签偏移:
  // - 展开态:贴侧栏右缘(app-body 无 padding/gap),= sidebarWidth
  // - 收起态:贴主题切换按钮右侧让位(侧栏按钮区 10+30 + 间隙 8 + 主题按钮 30 + 间隙 10 = 88)。
  //   红绿灯避让(--traffic-left)由 CSS 在 .sidebar-collapsed 时叠加到 margin-left,
  //   展开态不加(主内容区已在侧栏右侧,再加会错位)。全屏时 --traffic-left=0,自然适配。
  const tabsMarginLeft = sidebarCollapsed ? 88 : sidebarWidth;

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
  // 自实现 nearest 横向计算 + 平滑滚动(WKWebView 原生 scrollIntoView nearest 可能瞬移)。
  useEffect(() => {
    if (activeTabId == null) return;
    const container = tabsScrollRef.current;
    const el = container?.querySelector<HTMLElement>(
      `.topbar-tab[data-tab-id="${activeTabId}"]`,
    );
    if (!container || !el) return;
    const cLeft = container.scrollLeft;
    const cRight = cLeft + container.clientWidth;
    const eLeft = el.offsetLeft;
    const eRight = eLeft + el.offsetWidth;
    let target = cLeft;
    if (eLeft < cLeft) target = eLeft;
    else if (eRight > cRight) target = eRight - container.clientWidth;
    else return; // 已在可视区,nearest 不动
    smoothScrollTo(container, target, { duration: 220 });
  }, [activeTabId]);

  // 箭头点击:平滑滚动约一个大 tab 宽度(自实现 rAF,与编辑区跳转手感统一)
  const scrollTabs = useCallback((dir: 1 | -1) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    smoothScrollBy(el, dir * el.clientWidth * 0.8);
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
    // 源码模式:textarea 需保留焦点才能输入,不抢焦点、不 preventDefault
    if (t.closest(".source-view")) return;
    e.preventDefault();
    editorRef.current?.focusEditor();
  }, [editorRef]);

  // 有文件才显示文件名;无文件时不显示任何文字(保持标题栏干净)
  const fileName = currentPath ? baseName(currentPath) : "";
  // 有 tab 就允许关闭当前(editor-header 的关闭按钮)
  const canClose = activeTabId !== null;

  // 回到顶部:平滑滚动编辑器滚动容器(自实现 rAF,WKWebView 原生 smooth 不可靠)
  const onScrollToTop = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    smoothScrollTo(el, 0);
  }, []);

  return (
    <>
      {/* 背景层:用户上传图片 + 模糊 + 遮罩,固定铺满视口,位于所有容器之下。
          各容器半透明 → 透出本层 → 毛玻璃质感。无图时透明,露出 body 兜底色。 */}
      <div className="bg-layer" />
      <div
      className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}${bgImage ? " has-bg" : ""}${sourceMode ? " source-mode" : ""}`}
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
        {/* 主题切换按钮:紧邻侧栏切换按钮右侧,点击圆形扩散切换 light/dark */}
        <ThemeToggleButton
          theme={theme}
          onToggleTheme={toggleTheme}
          mac={!isWindows}
        />
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
        {tabs.length > 0 && (
          <button
            className="topbar-tab-add"
            onClick={newFile}
            title="新建文件"
            aria-label="新建文件"
          >
            <PlusIcon />
          </button>
        )}
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
              {fileName && (
                <span className="file-name" title={currentPath ?? ""}>
                  {fileName}
                </span>
              )}
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
              <MarkdownEditor ref={editorRef} onChange={onMdChange} onReady={onEditorReady} />
            </ErrorBoundary>
            {/* 源码模式:等宽字体 textarea 承载 md 原文,绝对定位覆盖 Milkdown。
                渲染条件含 editorReady:冷启动持久化源码模式时等 Milkdown 就绪再挂载,
                避免 getMarkdown 返回空。 */}
            {sourceMode && activeTabId && editorReady && (
              <SourceView
                ref={sourceViewRef}
                editorRef={editorRef}
                activeTabId={activeTabId}
                onMdChange={onMdChange}
                scrollContainerRef={wrapRef}
                initialScrollRatio={pendingScrollRatio}
              />
            )}
            {/* 无 tab,或当前为空白未命名未改时显示欢迎页(覆盖层) */}
            {(!activeTabId || (activeTab?.path === null && !activeTab.dirty)) && (
              <Welcome onOpenFile={() => void openFile()} onOpenFolder={() => void openFolder()} />
            )}
          </div>
          {/* 文档大纲:右侧 Notion 风格横条目录,hover 展开显示标题文字。
              标题超长时在原位横向滚动显示全文。无标题/无文档时不渲染。
              放在 .main-content 下(非 editor-wrap 内):大纲为 position:fixed,
              useOutline 走 scrollRef prop 查询,不依赖 DOM 父子,放外层更稳健。 */}
          {activeTabId && <Outline scrollRef={wrapRef} />}
          {/* 悬浮球工具按钮:定位在主内容区右下角,不随内容滚动 */}
          <FloatingBall
            scrollContainerRef={wrapRef}
            onScrollToTop={onScrollToTop}
            fontSize={fontSize}
            onCycleFontSize={cycleFontSize}
            sourceMode={sourceMode}
            onToggleSourceMode={toggleSourceMode}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
            onOpenBgSettings={() => setBgSettingsOpen(true)}
          />
        </main>
      </div>

      <ContextMenu
        position={ctxMenu ? { x: ctxMenu.x, y: ctxMenu.y } : null}
        items={ctxMenu?.items ?? []}
        onClose={closeCtx}
      />

      {/* 外观设置弹窗:背景图 + 毛玻璃参数(悬浮球入口) */}
      {bgSettingsOpen && (
        <SettingsModal
          bgImage={bgImage}
          bgBlur={bgBlur}
          bgDim={bgDim}
          glassBlur={glassBlur}
          glassOpacity={glassOpacity}
          onSetBgImage={setBgImage}
          onSetBgBlur={setBgBlur}
          onSetBgDim={setBgDim}
          onSetGlassBlur={setGlassBlur}
          onSetGlassOpacity={setGlassOpacity}
          onReset={resetBackground}
          onClose={() => setBgSettingsOpen(false)}
        />
      )}

      {/* 图片放大预览层 */}
      {preview && (
        <div className="img-lightbox" onClick={() => setPreview(null)}>
          <img src={preview.src} alt={preview.alt} />
        </div>
      )}
    </div>
    </>
  );
}

export default App;

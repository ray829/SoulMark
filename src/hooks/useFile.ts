import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { dirname } from "@tauri-apps/api/path";
import {
  ensureDir,
  pathExists,
  readFile,
  removePath,
  renamePath as fsRename,
  writeFile,
} from "../services/fs";
import type { EditorHandle } from "../components/Editor";
import { baseName, parentDir, joinPath } from "../utils/path";

/** 统一 Markdown 过滤器:与 Sidebar 的 isMarkdown 保持一致 */
const MD_FILTER = { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] };

/** 原生对话框按钮文字:plugin-dialog 默认按钮硬编码为英文 "Ok"/"Cancel",
 *  显式传中文,让删除确认/重名提示/错误框按钮为中文。 */
const ZH_OK = "确定";
const ZH_CANCEL = "取消";

/** 文件读写失败时的统一错误提示 */
async function showError(operation: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(`${operation}失败：${detail}`, {
    title: operation,
    kind: "error",
    buttons: { ok: ZH_OK },
  });
}

/** 单个标签:独立持有路径、内容、脏标记、滚动位置、光标位置 */
export interface Tab {
  id: number;
  path: string | null; // null = 未命名/未保存
  markdown: string;
  dirty: boolean;
  /** 文件已被外部删除(Finder 等):保留内容与原名,保存走另存为,不写回原路径。
   *  由窗口聚焦时的 reconcileDeletedTabs 标记;另存为成功后清除。 */
  deleted?: boolean;
  scrollTop: number;
  selection: { anchor: number; head: number } | null;
}

/**
 * 多 Tab 文件读写 hook:每个 Tab 独立 path/dirty/markdown/scrollTop,
 * 切换时 getMarkdown(同步)回写当前 tab、setMarkdown(同步)加载目标 tab。
 * per-tab 自动保存(dirty 且有 path 的 tab,debounce 1500ms)。
 * 关闭按 path/dirty 分流:有 path 自动保存、无 path 且 dirty 弹 save dialog,无确认框。
 * 维护 rootDir(供文件树)、fsVersion + fsChange(供文件树局部刷新)。
 */
export function useFile(
  editorRef: React.RefObject<EditorHandle | null>,
  wrapRef: React.RefObject<HTMLDivElement | null>,
  /** 源码模式内容同步:源码模式编辑后 Milkdown 未实时更新,切 tab/保存/另存
   *  读 getMarkdown 前先 flush(把 textarea 内容写回 Milkdown),避免丢数据。
   *  非源码模式为 no-op。 */
  flushSource?: () => void,
) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [fsVersion, setFsVersion] = useState(0);
  const [fsChange, setFsChange] = useState<Set<string> | null>(null);
  // 新建文件后待重命名的路径:文件树节点匹配后自动进入编辑态,完成/取消后清空
  const [pendingRename, setPendingRename] = useState<string | null>(null);

  // ref 镜像:供事件回调(async/await 之后、debounce timer 内)读最新值,避免 stale closure
  const tabsRef = useRef<Tab[]>([]);
  const activeTabIdRef = useRef<number | null>(null);
  const rootDirRef = useRef<string | null>(null);
  const tabIdRef = useRef(0);

  // flushSource ref 镜像:函数内读 ref.current 拿最新值,避免 flushSource 变化
  // 导致 flushCurrentTab/saveFile/saveAsFile 及其下游连锁重建(切 tab 是热路径)
  const flushSourceRef = useRef<(() => void) | undefined>(flushSource);
  useEffect(() => {
    flushSourceRef.current = flushSource;
  }, [flushSource]);

  /** 统一更新 tabs:基于 ref 同步计算并立即写回 ref,state 触发 render。
   *  所有 tab 写操作必须走本函数,保证 ref 与 state 一致(最易出 bug 处)。 */
  const setTabsBoth = useCallback((updater: (prev: Tab[]) => Tab[]) => {
    const next = updater(tabsRef.current);
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const commitActive = useCallback((id: number | null) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);

  const setRootDirBoth = useCallback((dir: string | null) => {
    rootDirRef.current = dir;
    setRootDir(dir);
    // 切换文件夹:兜底全刷(fsChange=null → shouldReloadChildren 恒 true)。
    // 否则旧 fsChange(指向原文件夹的路径)会让新文件夹的 shouldReloadChildren 误判为 false → 不重读 → 卡在"加载中"。
    setFsChange(null);
  }, []);

  const nextId = () => ++tabIdRef.current;

  /** 触发文件树刷新:paths 为受影响路径(局部刷新),省略则全刷(兜底)。 */
  const bumpFs = useCallback((paths?: string[]) => {
    setFsChange(paths ? new Set(paths) : null);
    setFsVersion((v) => v + 1);
  }, []);

  /** 同步回写当前 active tab:把 editor 最新 markdown + scrollTop + 光标存回 tab。
   *  优化:当前 tab 未 dirty 时,markdown 未变(getMarkdown 序列化大文档较慢),直接复用 tab.markdown,
   *  仅读 scrollTop + selection(便宜)。dirty 时才 getMarkdown 取最新内容。 */
  const flushCurrentTab = useCallback(() => {
    const editor = editorRef.current;
    const id = activeTabIdRef.current;
    if (!editor || id == null) return;
    const cur = tabsRef.current.find((t) => t.id === id);
    if (!cur) return;
    // 源码模式时先把 textarea 内容写回 Milkdown,确保 getMarkdown 读到最新
    flushSourceRef.current?.();
    // 仅在 dirty(内容已变)时才读 editor.getMarkdown(),避免未编辑 tab 切换时序列化整篇文档
    const md = cur.dirty ? editor.getMarkdown() : cur.markdown;
    const st = wrapRef.current?.scrollTop ?? 0;
    const sel = editor.getSelection();
    setTabsBoth((prev) =>
      prev.map((t) => (t.id === id ? { ...t, markdown: md, scrollTop: st, selection: sel } : t)),
    );
  }, [editorRef, wrapRef, setTabsBoth]);

  /** 恢复目标 tab 的 scrollTop:双 rAF 等 DOM 与异步渲染落地(代码块高亮/mermaid 可能轻微偏移)。 */
  const restoreScrollTop = useCallback((st: number) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (wrapRef.current) wrapRef.current.scrollTop = st;
      });
    });
  }, [wrapRef]);

  /** 从 tabs 移除指定 tab 且不保存(用于磁盘文件已被删除等场景,避免保存把删掉的文件又写回)。
   *  若移除的是 active,激活相邻 tab(优先同位右,次左)并同步 editor;无邻则清空进空态。 */
  const removeTabNoSave = useCallback((id: number) => {
    const editor = editorRef.current;
    const idx = tabsRef.current.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const wasActive = activeTabIdRef.current === id;
    const nextTabs = tabsRef.current.filter((t) => t.id !== id);
    setTabsBoth(() => nextTabs);
    if (wasActive) {
      const nextTab = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
      if (nextTab && editor) {
        editor.setMarkdown(nextTab.markdown);
        if (nextTab.selection) editor.setSelection(nextTab.selection.anchor, nextTab.selection.head);
        commitActive(nextTab.id);
        restoreScrollTop(nextTab.scrollTop);
      } else {
        editor?.setMarkdown("");
        commitActive(null);
      }
    }
  }, [editorRef, setTabsBoth, commitActive, restoreScrollTop]);

  /** 同步已打开 tab 的删除状态:批量检查有 path 且未标 deleted 的 tab 对应文件是否仍存在,
   *  不存在的标记 deleted(保留内容与原名)。窗口聚焦时触发,捕捉 Finder 等外部删除。
   *  静默标记(不弹框):由 tab 删除线 + editor-header 提示条告知用户,不打断编辑。 */
  const reconcileDeletedTabs = useCallback(async () => {
    const candidates = tabsRef.current.filter((t) => t.path != null && !t.deleted);
    if (candidates.length === 0) return;
    const results = await Promise.all(
      candidates.map(async (t) => {
        try { return { id: t.id, gone: !(await pathExists(t.path as string)) }; }
        catch { return { id: t.id, gone: true }; }
      }),
    );
    const goneIds = new Set(results.filter((r) => r.gone).map((r) => r.id));
    if (goneIds.size === 0) return;
    setTabsBoth((prev) =>
      prev.map((t) => (goneIds.has(t.id) ? { ...t, deleted: true } : t)),
    );
  }, [setTabsBoth]);

  /** 切换到指定 tab:回写当前 → 同步加载目标 → 下一帧恢复光标与滚动。
   *  setMarkdown(parser+updateState)是同步重操作,放当前帧;
   *  setSelection 与 restoreScrollTop 延到下一帧,避免 click handler 长时间阻塞主线程。
   *  setSelection 在 setMarkdown 之后:updateState 重建状态时选区默认在开头,此处按 target.selection 恢复。 */
  const switchTab = useCallback((targetId: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const currentId = activeTabIdRef.current;
    if (currentId === targetId) return;
    const target = tabsRef.current.find((t) => t.id === targetId);
    if (!target) return;
    if (currentId != null) flushCurrentTab();
    editor.setMarkdown(target.markdown);
    commitActive(targetId);
    // 光标与滚动延到下一帧:setMarkdown 同步提交后浏览器先渲染,再恢复选区/位置,UI 不卡顿
    const sel = target.selection;
    const st = target.scrollTop;
    requestAnimationFrame(() => {
      if (sel) editor.setSelection(sel.anchor, sel.head);
      if (wrapRef.current) wrapRef.current.scrollTop = st;
    });
  }, [editorRef, flushCurrentTab, commitActive]);

  /** Milkdown 内容变化:置当前 active tab dirty。
   *  仅在 dirty false→true 时 setTabs,避免每次按键 render。
   *  replaceAll(flush=true) 不触本回调,切 tab 加载内容不误置 dirty。 */
  const onMdChange = useCallback(() => {
    const id = activeTabIdRef.current;
    if (id == null) return;
    const cur = tabsRef.current.find((t) => t.id === id);
    if (cur?.dirty) return;
    setTabsBoth((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dirty: true } : t)),
    );
  }, [setTabsBoth]);

  /** 按路径打开:去重(已开则切换)→ 否则新建 tab 加载。
   *  不再 ask 放弃当前:当前 tab 被保留(flush 回写)。
   *  await readFile 期间用户可能切换:返回后 flush 当前(保留其编辑)再激活新 tab。 */
  const openByPath = useCallback(async (path: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const existing = tabsRef.current.find((t) => t.path === path);
    if (existing) {
      switchTab(existing.id);
      return;
    }
    // 存在性校验:外部(如 Finder)可能已删除文件,避免 readFile 抛技术错误。
    // 不存在则友好提示并刷新文件树,让已删除节点从树中消失。
    let exists = true;
    try {
      exists = await pathExists(path);
    } catch {
      exists = false;
    }
    if (!exists) {
      await message(`文件不存在或已被删除:\n${baseName(path)}`, {
        title: "打开文件",
        kind: "warning",
        buttons: { ok: ZH_OK },
      });
      bumpFs([path]);
      return;
    }
    let content: string;
    try {
      content = await readFile(path);
    } catch (err) {
      await showError("打开文件", err);
      return;
    }
    // 当前 tab 是空白未命名未改时复用(与 newFile 对称),避免空 tab 堆积:
    // 点加号开空白 tab → 点文件树选文件 → 文件直接填进当前 tab,不另开新壳。
    const cur = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (cur && cur.path === null && !cur.dirty && cur.markdown === "") {
      setTabsBoth((prev) =>
        prev.map((t) =>
          t.id === cur.id
            ? { ...t, path, markdown: content, dirty: false, scrollTop: 0, selection: null }
            : t,
        ),
      );
      editor.setMarkdown(content);
      // activeTabId 不变,无需 commitActive;当前空白无需 flush
      if (wrapRef.current) wrapRef.current.scrollTop = 0;
      if (!rootDirRef.current) {
        dirname(path).then(setRootDirBoth).catch(() => {});
      }
      return;
    }
    // 当前 tab 有内容/已是文件:flush 保留,再新建 tab
    flushCurrentTab();
    const id = nextId();
    const tab: Tab = { id, path, markdown: content, dirty: false, scrollTop: 0, selection: null };
    setTabsBoth((prev) => [...prev, tab]);
    editor.setMarkdown(content);
    commitActive(id);
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
    if (!rootDirRef.current) {
      dirname(path).then(setRootDirBoth).catch(() => {});
    }
  }, [editorRef, switchTab, flushCurrentTab, setTabsBoth, commitActive, wrapRef, setRootDirBoth, bumpFs]);

  const openFile = useCallback(async () => {
    const path = await open({ filters: [MD_FILTER] });
    if (typeof path !== "string") return;
    await openByPath(path);
  }, [openByPath]);

  /** 打开文件夹:以所选目录为文件树根(不打开具体文件)。
   *  返回所选目录路径,用户取消时返回 null(供调用方据此做后续 UI 反馈)。
   *  切换文件夹 = 换工作区:已打开的文件应全部关闭(dirty 的先保存,沿用 closeTab
   *  约定:有 path 非 deleted 写回原路径;untitled/deleted 弹 save dialog 让用户决定,
   *  取消即丢弃该文件内容)。保存失败不阻断切换(继续切到新文件夹)。 */
  const openFolder = useCallback(async (): Promise<string | null> => {
    const dir = await open({ directory: true });
    if (typeof dir !== "string") return null;
    // 先 flush 当前 active,把 editor 最新内容写回 tab.markdown,供下方批量保存读到
    flushCurrentTab();
    const cur = tabsRef.current;
    if (cur.length > 0) {
      for (const t of cur) {
        if (!t.dirty) continue;
        if (t.path != null && !t.deleted) {
          try {
            await writeFile(t.path, t.markdown);
          } catch (err) {
            await showError("保存文件", err);
          }
        } else {
          // 未命名 / 已删除:弹 save dialog 让用户选保存位置,取消即丢弃
          const path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
          if (path) {
            try {
              await writeFile(path, t.markdown);
            } catch (err) {
              await showError("保存文件", err);
            }
          }
        }
      }
      // 清空所有 tabs + editor,进入空态
      setTabsBoth(() => []);
      editorRef.current?.setMarkdown("");
      commitActive(null);
    }
    setRootDirBoth(dir);
    return dir;
  }, [flushCurrentTab, setTabsBoth, editorRef, commitActive, setRootDirBoth]);

  /** 另存为:总弹 dialog;写盘后 tab.path 更新(原磁盘文件不变,VS Code 式)。 */
  const saveAsFile = useCallback(async () => {
    const editor = editorRef.current;
    const id = activeTabIdRef.current;
    if (!editor || id == null) return;
    // 源码模式时先把 textarea 内容写回 Milkdown,确保另存的是最新编辑
    flushSourceRef.current?.();
    const md = editor.getMarkdown();
    const path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
    if (!path) return;
    try {
      await writeFile(path, md);
      // 另存为新路径后,deleted 状态清除:文件已落到新真实路径,恢复正常 tab 语义
      setTabsBoth((prev) =>
        prev.map((t) => (t.id === id ? { ...t, path, markdown: md, dirty: false, deleted: false } : t)),
      );
      if (!rootDirRef.current) dirname(path).then(setRootDirBoth).catch(() => {});
    } catch (err) {
      await showError("保存文件", err);
    }
  }, [editorRef, setTabsBoth, setRootDirBoth]);

  /** 保存当前 tab:有 path 直接写;无 path 弹 save dialog。Cmd+S 立即保存(绕 debounce)。
   *  deleted:文件已被外部删除,保存走另存为(不写回原路径,避免"复活"被删文件)。 */
  const saveFile = useCallback(async () => {
    const editor = editorRef.current;
    const id = activeTabIdRef.current;
    if (!editor || id == null) return;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    // deleted 走另存为:原路径已不存在,不能写回(否则偷偷重建被删文件)
    if (tab.deleted) return saveAsFile();
    // 源码模式时先把 textarea 内容写回 Milkdown,确保保存的是最新编辑
    flushSourceRef.current?.();
    const md = editor.getMarkdown();
    let path = tab.path;
    if (!path) {
      path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
      if (!path) return;
    }
    try {
      await writeFile(path, md);
      setTabsBoth((prev) =>
        prev.map((t) => (t.id === id ? { ...t, path, markdown: md, dirty: false } : t)),
      );
      if (!rootDirRef.current) dirname(path).then(setRootDirBoth).catch(() => {});
    } catch (err) {
      await showError("保存文件", err);
    }
  }, [editorRef, setTabsBoth, setRootDirBoth, saveAsFile]);

  /** 新建文件:在 rootDir 下创建 untitled-N.md(重名加序号)→ 写盘 → 打开 tab。
   *  创建后触发文件树重命名编辑态(pendingRename),聚焦让用户改名。
   *  无 rootDir(未打开文件夹):弹"另存为"对话框让用户选位置+文件名,一步创建真实文件。 */
  const newFile = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const dir = rootDirRef.current;
    if (!dir) {
      // 未打开文件夹:弹"另存为"让用户选位置+文件名,写盘后打开
      const path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
      if (!path) return; // 用户取消
      try {
        await writeFile(path, "");
      } catch (err) {
        await showError("新建文件", err);
        return;
      }
      await openByPath(path);
      return;
    }
    // 生成唯一文件名:untitled.md → untitled-2.md → untitled-3.md …
    let path = "";
    for (let n = 1; ; n++) {
      const name = n === 1 ? "untitled.md" : `untitled-${n}.md`;
      path = joinPath(dir, name);
      if (!(await pathExists(path))) break;
    }
    try {
      await writeFile(path, "");
    } catch (err) {
      await showError("新建文件", err);
      return;
    }
    bumpFs([path]);
    await openByPath(path);
    setPendingRename(path);
  }, [editorRef, bumpFs, openByPath]);

  /** 关闭指定 tab(采纳自动保存策略):
   *  - path!=null 且 dirty:flush 保存后关(无确认);失败不关
   *  - path!=null 且 dirty 且 !deleted:写回原路径后关
   *  - deleted 或 path==null 且 dirty:弹 save dialog(不写回原路径,deleted 文件已不存在)
   *  - !dirty:直接关
   *  关闭 active 则激活相邻(优先右,次左);无邻→空态。 */
  const closeTab = useCallback(async (id: number) => {
    // 若关的是 active,先 flush 取最新 markdown 供保存
    if (activeTabIdRef.current === id) flushCurrentTab();
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      // deleted 的 tab 原文件已被删除,不能写回(否则重建被删文件)→ 走另存为
      if (tab.path != null && !tab.deleted) {
        try {
          await writeFile(tab.path, tab.markdown);
        } catch (err) {
          await showError("保存文件", err);
          return; // 不关
        }
      } else {
        const path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
        if (!path) return; // 取消,不关
        try {
          await writeFile(path, tab.markdown);
        } catch (err) {
          await showError("保存文件", err);
          return;
        }
      }
    }
    removeTabNoSave(id);
  }, [flushCurrentTab, removeTabNoSave]);

  /** 关闭当前 active tab(供 editor-close 按钮 + Cmd+W) */
  const closeFile = useCallback(async () => {
    const id = activeTabIdRef.current;
    if (id == null) return;
    await closeTab(id);
  }, [closeTab]);

  /** 关闭其他:先切到保留 tab(回写当前),再逐个关闭(此时其他均非 active)。 */
  const closeOthers = useCallback(async (id: number) => {
    switchTab(id);
    const others = tabsRef.current.filter((t) => t.id !== id).map((t) => t.id);
    for (const oid of others) {
      await closeTab(oid);
    }
  }, [switchTab, closeTab]);

  /** 关闭右侧所有 tab */
  const closeRight = useCallback(async (id: number) => {
    const idx = tabsRef.current.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const right = tabsRef.current.slice(idx + 1).map((t) => t.id);
    for (const rid of right) {
      await closeTab(rid);
    }
  }, [closeTab]);

  /** 拖拽排序:把 fromId 的 tab 移到 toId 的 before/after 位置。
   *  不影响 active tab 与 editor 内容(只重排数组顺序)。from===to 时不动。 */
  const moveTab = useCallback((fromId: number, toId: number, place: "before" | "after") => {
    if (fromId === toId) return;
    setTabsBoth((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      if (fromIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1); // 先移除
      // 移除后用 toId 重新定位(索引已稳定),再按 place 插入
      const toIdx = next.findIndex((t) => t.id === toId);
      if (toIdx < 0) {
        // 目标被移除(不应发生,from!==to),兜底放回原位
        next.splice(fromIdx, 0, moved);
        return next;
      }
      const insertAt = place === "before" ? toIdx : toIdx + 1;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }, [setTabsBoth]);

  /** 删除文件/目录(二次确认,递归删除)。
   *  匹配的 tab 直接关闭移除(不转未命名+dirty):文件已从磁盘删除,
   *  若保留为未命名 tab,用户保存会把被删文件又写回磁盘,违背删除语义。
   *  局部刷新:仅通知被删路径所在子树重读。 */
  const deletePath = useCallback(async (path: string) => {
    const ok = await ask(`确定删除 "${baseName(path)}"?此操作不可撤销。`, {
      title: "删除",
      kind: "warning",
      okLabel: ZH_OK,
      cancelLabel: ZH_CANCEL,
    });
    if (!ok) return;
    try {
      await removePath(path);
    } catch (err) {
      await showError("删除", err);
      return;
    }
    // 磁盘文件已删,关闭对应 tab(不保留为未命名,以免保存又把文件写回)
    const matched = tabsRef.current.filter((t) => t.path === path);
    for (const tab of matched) {
      removeTabNoSave(tab.id);
    }
    bumpFs([path]);
  }, [removeTabNoSave, bumpFs]);

  /** 重命名(撞名检查)。同步更新匹配 tab 的 path。返回是否成功。
   *  局部刷新:同时通知新旧路径所在子树重读。 */
  const renamePath = useCallback(async (oldPath: string, newName: string): Promise<boolean> => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === baseName(oldPath)) return false;
    const newPath = joinPath(parentDir(oldPath), trimmed);
    if (await pathExists(newPath)) {
      await ask(`"${trimmed}" 已存在,请换个名字。`, { title: "重名", kind: "warning", okLabel: ZH_OK, cancelLabel: ZH_CANCEL });
      return false;
    }
    try {
      await fsRename(oldPath, newPath);
    } catch (err) {
      await showError("重命名", err);
      return false;
    }
    setTabsBoth((prev) =>
      prev.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)),
    );
    bumpFs([oldPath, newPath]);
    return true;
  }, [setTabsBoth, bumpFs]);

  /** 在指定目录下新建 Markdown 文件并打开(撞名检查)。
   *  局部刷新:仅通知新文件路径所在子树重读。 */
  const createFileIn = useCallback(async (dir: string, name: string): Promise<boolean> => {
    const raw = name.trim();
    if (!raw) return false;
    const fname = /\.(md|markdown|mdown|mkd|txt)$/i.test(raw) ? raw : `${raw}.md`;
    const path = joinPath(dir, fname);
    if (await pathExists(path)) {
      await ask(`"${fname}" 已存在,请换个名字。`, { title: "重名", kind: "warning", okLabel: ZH_OK, cancelLabel: ZH_CANCEL });
      return false;
    }
    try {
      await writeFile(path, "");
    } catch (err) {
      await showError("新建文件", err);
      return false;
    }
    bumpFs([path]);
    await openByPath(path);
    return true;
  }, [openByPath, bumpFs]);

  /** 在指定目录下新建文件夹(撞名检查)。 */
  const createDirIn = useCallback(async (dir: string, name: string): Promise<boolean> => {
    const raw = name.trim();
    if (!raw) return false;
    const path = joinPath(dir, raw);
    if (await pathExists(path)) {
      await ask(`"${raw}" 已存在,请换个名字。`, { title: "重名", kind: "warning", okLabel: ZH_OK, cancelLabel: ZH_CANCEL });
      return false;
    }
    try {
      await ensureDir(path);
    } catch (err) {
      await showError("新建文件夹", err);
      return false;
    }
    bumpFs([path]);
    return true;
  }, [bumpFs]);

  // per-tab 自动保存:dirty 且有 path 的 tab,debounce 1500ms 写盘。
  // active tab 用 editor.getMarkdown() 取最新;非 active 用 tab.markdown(切换时 flush 的)。
  // active tab 保存后只清 dirty、不覆盖 markdown(避免 writeFile 期间用户输入被旧值覆盖);
  //   editor 是 active tab 的 source of truth,markdown 在下次切换时由 flushCurrentTab 同步。
  // 保存失败 showError 且保留 dirty(下次重试)。
  useEffect(() => {
    // 跳过 deleted:文件已被外部删除,自动保存会偷偷把文件写回原路径"复活"它。
    // deleted 的 tab 保存走另存为(saveFile/saveAsFile),不在此自动写盘。
    const dirtyTabs = tabs.filter((t) => t.dirty && t.path != null && !t.deleted);
    if (dirtyTabs.length === 0) return;
    const timers = dirtyTabs.map((t) =>
    window.setTimeout(async () => {
        const cur = tabsRef.current.find((x) => x.id === t.id);
        if (!cur || !cur.dirty || cur.path == null) return;
        // active tab 用 editor 最新内容;非 active 用 tab.markdown(切换时 flush 的)
        let md = cur.markdown;
        // 保存前记录 doc 版本(引用):await 后比较引用即可判断写盘期间是否有新输入,
        // 无需第二次 getMarkdown() 序列化大文档(原方案的性能瓶颈)。
        let docVer: unknown = null;
        if (activeTabIdRef.current === cur.id) {
          const editor = editorRef.current;
          if (editor) {
            md = editor.getMarkdown();
            docVer = editor.getDocVersion();
          }
        }
        try {
          await writeFile(cur.path, md);
          // 保存成功后清 dirty。active tab 以 editor 当前内容为准:
          // 若 writeFile 期间用户又输入了(doc 引用已变),保留 dirty 让下次 timer 重存新内容;
          // 否则同步 markdown 为 md 并清 dirty —— 否则 active tab 的 markdown 是 stale 旧值,
          // 恒不等于 md → dirty 清不掉 → setTabsBoth 产生新数组 → effect 重跑 → 死循环每 1.5s 重写盘。
          // 非 active tab 的 markdown 在切走时已 flush,等于 md 即无新编辑,直接清 dirty。
          // doc 引用比较 O(1),替代原方案第二次 getMarkdown()(大文档序列化耗时,主线程卡顿根因)。
          const changedDuringSave =
            activeTabIdRef.current === cur.id &&
            docVer != null &&
            editorRef.current?.getDocVersion() !== docVer;
          setTabsBoth((prev) =>
            prev.map((x) => {
              if (x.id !== cur.id) return x;
              if (changedDuringSave) {
                return { ...x, dirty: true, markdown: md };
              }
              return x.markdown === md ? { ...x, dirty: false } : { ...x, dirty: false, markdown: md };
            }),
          );
        } catch (err) {
          await showError("自动保存", err);
        }
      }, 1500),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [tabs, setTabsBoth]);

  // 窗口重新聚焦时刷新文件树:用户在 Finder 等外部工具增删文件后,切回应用自动同步。
  // 仅 blur→focus 转换触发(避免首次挂载或持续聚焦时频繁刷新);有 rootDir 才刷。
  // bumpFs() 兜底全刷:已展开目录按 shouldReloadChildren 重读,未展开目录不读。
  // 同时 reconcileDeletedTabs:检测已打开文件被外部删除,标记 deleted(不偷偷写回)。
  useEffect(() => {
    let wasFocused = document.hasFocus();
    const onFocus = () => {
      if (wasFocused) return; // 持续聚焦不重复刷
      wasFocused = true;
      if (rootDirRef.current) bumpFs();
      void reconcileDeletedTabs();
    };
    const onBlur = () => { wasFocused = false; };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [bumpFs, reconcileDeletedTabs]);

  // 派生(供现有消费者兼容)
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );
  const currentPath = activeTab?.path ?? null;
  const dirty = activeTab?.dirty ?? false;
  const openPaths = useMemo(
    () => new Set(tabs.map((t) => t.path).filter((p): p is string => p != null)),
    [tabs],
  );

  // 清除待重命名标记:文件树重命名完成/取消后调用
  const clearPendingRename = useCallback(() => setPendingRename(null), []);

  return {
    // tab 状态
    tabs,
    activeTabId,
    activeTab,
    openPaths,
    switchTab,
    closeTab,
    closeOthers,
    closeRight,
    moveTab,
    // 兼容派生
    currentPath,
    dirty,
    // 文件操作
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
    // 文件树
    rootDir,
    fsVersion,
    fsChange,
    // 新建文件后触发文件树重命名
    pendingRename,
    clearPendingRename,
  };
}

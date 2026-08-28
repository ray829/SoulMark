import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItem } from "./ContextMenu";
import { TreeNode } from "./TreeNode";
import { PromptDialog } from "./PromptDialog";
import {
  FileMarkdown,
  FileOpenIcon,
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
} from "./icons";
import {
  readChildren,
  searchMarkdown,
  shouldReloadChildren,
  type DialogOpts,
  type FileNode,
  type TreeCtx,
} from "../hooks/useFileTree";
import { baseName } from "../utils/path";

interface SidebarProps {
  rootDir: string | null;
  openPaths: Set<string>;
  fsVersion: number;
  fsChange: Set<string> | null;
  /** 新建文件后待重命名的路径:匹配的文件树节点自动进入编辑态 */
  pendingRename: string | null;
  /** 文件树重命名完成/取消后清除 pendingRename */
  onRenameDone: () => void;
  onSelect: (path: string) => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onNewFile: () => void;
  /** 由 App 承载的右键菜单触发器:传坐标 + 菜单项 */
  onContext: (e: React.MouseEvent, items: MenuItem[]) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => Promise<boolean>;
  onCreateFile: (dir: string, name: string) => Promise<boolean>;
  onCreateDir: (dir: string, name: string) => Promise<boolean>;
}

export function Sidebar({
  rootDir,
  openPaths,
  fsVersion,
  fsChange,
  pendingRename,
  onRenameDone,
  onSelect,
  onOpenFolder,
  onOpenFile,
  onNewFile,
  onContext,
  onDelete,
  onRename,
  onCreateFile,
  onCreateDir,
}: SidebarProps) {
  const [roots, setRoots] = useState<FileNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogOpts | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FileNode[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K 聚焦搜索框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 搜索防抖:非空时 BFS 扫描,空时清空结果
  useEffect(() => {
    const q = search.trim();
    if (!q || !rootDir) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchMarkdown(rootDir, q).then((r) => {
        if (!cancelled) setResults(r);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, rootDir, fsVersion]);

  // 根级子项:受 fsChange 控制局部刷新,未受影响时跳过 readDir
  useEffect(() => {
    setRoots(null);
    setError(null);
    if (!rootDir) return;
    if (!shouldReloadChildren(rootDir, fsChange)) {
      // 保留已有 roots,不重读
      return;
    }
    let cancelled = false;
    readChildren(rootDir)
      .then((n) => {
        if (!cancelled) setRoots(n);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [rootDir, fsVersion, fsChange]);

  const ctx: TreeCtx = useMemo(
    () => ({
      fsVersion,
      fsChange,
      onContext,
      onDelete,
      onRename,
      onCreateFile,
      onCreateDir,
      openDialog: (opts) => setDialog(opts),
    }),
    [fsVersion, fsChange, onContext, onDelete, onRename, onCreateFile, onCreateDir],
  );

  const searching = search.trim().length > 0;

  const fileTree = error ? (
    <div className="sidebar-empty">
      <p className="empty-text">读取失败：{error}</p>
    </div>
  ) : !roots ? (
    <div className="sidebar-empty">
      <p className="empty-text">加载中…</p>
    </div>
  ) : roots.length === 0 ? (
    <div className="sidebar-empty">
      <p className="empty-text">空目录</p>
    </div>
  ) : (
    roots.map((n) => (
      <TreeNode
        key={n.fullPath}
        node={n}
        openPaths={openPaths}
        depth={0}
        onSelect={onSelect}
        ctx={ctx}
        pendingRename={pendingRename}
        onRenameDone={onRenameDone}
      />
    ))
  );

  return (
    <aside className="sidebar">
      {/* 搜索栏:⌘K 聚焦,实时过滤 md 文件。无 rootDir 时隐藏(搜索依赖文件夹)。 */}
      {rootDir && (
        <div className="nav-search">
          <SearchIcon />
          <input
            ref={searchRef}
            value={search}
            placeholder="搜索..."
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch("");
            }}
          />
          <span className="nav-search-kbd">⌘K</span>
        </div>
      )}

      {/* 搜索结果 / 文件树 */}
      {searching ? (
        <div className="nav-section">
          <div className="nav-section-title">搜索结果</div>
          {results === null ? (
            <div className="tree-empty"><span className="tree-slot" />搜索中…</div>
          ) : results.length === 0 ? (
            <div className="tree-empty"><span className="tree-slot" />无匹配文件</div>
          ) : (
            results.map((r) => (
              <div
                key={r.fullPath}
                className={`tree-row search-row${openPaths.has(r.fullPath) ? " active" : ""}`}
                onClick={() => {
                  onSelect(r.fullPath);
                  setSearch("");
                }}
                title={r.fullPath}
              >
                <span className="tree-icon"><FileMarkdown /></span>
                <span className="tree-name">{r.name}</span>
              </div>
            ))
          )}
        </div>
      ) : rootDir ? (
        <div className="nav-section">
          <div className="nav-section-title">文件</div>
          {fileTree}
        </div>
      ) : (
        <div className="sidebar-empty">
          <FolderOpenIcon className="empty-icon" />
          <p className="empty-text">打开一个文件或文件夹<br />这里会显示文件树</p>
        </div>
      )}

      {/* 底部操作条:文件夹名(点击切换/打开文件夹) + 右侧新建/打开文件图标。
          无 rootDir 时左侧变"打开文件夹"按钮,右侧图标置灰。 */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-bar">
          <button
            className="sidebar-folder-name"
            onClick={onOpenFolder}
            title={rootDir ? `切换文件夹(当前:${rootDir})` : "打开文件夹"}
          >
            <FolderOpenIcon />
            <span className="sidebar-folder-label">
              {rootDir ? baseName(rootDir) : "打开文件夹"}
            </span>
          </button>
          <div className="sidebar-footer-actions">
            <button
              className="sidebar-footer-btn"
              onClick={onNewFile}
              title="新建文件"
              aria-label="新建文件"
              disabled={!rootDir}
            >
              <PlusIcon />
            </button>
            <button
              className="sidebar-footer-btn"
              onClick={onOpenFile}
              title="打开文件"
              aria-label="打开文件"
            >
              <FileOpenIcon />
            </button>
          </div>
        </div>
      </div>

      {dialog && <PromptDialog opts={dialog} onClose={() => setDialog(null)} />}
    </aside>
  );
}

export default Sidebar;

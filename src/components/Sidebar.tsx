import { useEffect, useMemo, useRef, useState } from "react";
import { readDir } from "@tauri-apps/plugin-fs";
import type { MenuItem } from "./ContextMenu";
import { baseName, isMarkdown, joinPath } from "../utils/path";

interface SidebarProps {
  rootDir: string | null;
  currentPath: string | null;
  fsVersion: number;
  onSelect: (path: string) => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onNewFile: () => void;
  /** 由 App 承载的右键菜单触发器：传坐标 + 菜单项 */
  onContext: (e: React.MouseEvent, items: MenuItem[]) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => Promise<boolean>;
  onCreateFile: (dir: string, name: string) => Promise<boolean>;
  onCreateDir: (dir: string, name: string) => Promise<boolean>;
}

interface Node {
  name: string;
  fullPath: string;
  isDirectory: boolean;
}

/** 新建输入浮层的配置 */
interface DialogOpts {
  title: string;
  value?: string;
  hint?: string;
  onConfirm: (v: string) => Promise<boolean | void>;
}

/** 透传给每个 TreeNode 的上下文（避免逐个透传 prop） */
interface TreeCtx {
  fsVersion: number;
  onContext: (e: React.MouseEvent, items: MenuItem[]) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => Promise<boolean>;
  onCreateFile: (dir: string, name: string) => Promise<boolean>;
  onCreateDir: (dir: string, name: string) => Promise<boolean>;
  openDialog: (opts: DialogOpts) => void;
}

/** 读取目录直接子项：隐藏以 . 开头的项，文件夹保留，文件仅显示 md 文档；文件夹优先 + 字母序 */
async function readChildren(parentPath: string): Promise<Node[]> {
  const entries = await readDir(parentPath);
  const nodes: Node[] = entries
    .filter(
      (e) => !e.name.startsWith(".") && (e.isDirectory || isMarkdown(e.name)),
    )
    .map((e) => ({
      name: e.name,
      fullPath: joinPath(parentPath, e.name),
      isDirectory: e.isDirectory,
    }));
  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return nodes;
}

/** 搜索：BFS 递归扫描 rootDir，收集文件名包含 query 的 md 文件（上限 50） */
async function searchMarkdown(root: string, query: string, limit = 50): Promise<Node[]> {
  const q = query.toLowerCase();
  const results: Node[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && results.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (results.length >= limit) break;
      if (!e.name || e.name.startsWith(".")) continue;
      const full = joinPath(dir, e.name);
      if (e.isDirectory) {
        queue.push(full);
      } else if (isMarkdown(e.name) && e.name.toLowerCase().includes(q)) {
        results.push({ name: e.name, fullPath: full, isDirectory: false });
      }
    }
  }
  return results;
}

/* 平台修饰键 */
const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const M = isMac ? "⌘" : "Ctrl";

/* ===== 内联 SVG 图标（16px，统一 stroke 风格） ===== */
type IconProps = { className?: string };

function ChevronRight({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
function ChevronDown({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6h6l2 2h12v12H2z" />
    </svg>
  );
}
function FolderOpenIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 14l1.5-4.5h13L19 14z" />
      <path d="M3 18V6h6l2 2h8v2" />
      <path d="M3 18h16" />
    </svg>
  );
}
function FileMarkdown({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 16V8l3 4 3-4v8" />
    </svg>
  );
}
function FileGeneric({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}
function FileOpenIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
      <path d="M9 14h6M9 17h4" />
    </svg>
  );
}
function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

/** 渲染 depth 条缩进辅助线 */
function Indents({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="tree-indent" />
      ))}
    </>
  );
}

/** 内联重命名输入框：Enter 提交、Esc 取消、失焦提交 */
function TreeInput(props: {
  defaultValue?: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = () => {
    if (cancelledRef.current) return;
    const v = (ref.current?.value ?? "").trim();
    if (v) props.onSubmit(v);
    else props.onCancel();
  };
  return (
    <input
      ref={ref}
      className="tree-input"
      defaultValue={props.defaultValue}
      onClick={(e) => e.stopPropagation()}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          props.onCancel();
        }
      }}
    />
  );
}

function TreeNode({
  node,
  currentPath,
  depth,
  onSelect,
  ctx,
}: {
  node: Node;
  currentPath: string | null;
  depth: number;
  onSelect: (p: string) => void;
  ctx: TreeCtx;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Node[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameMode, setRenameMode] = useState(false);
  const active = currentPath === node.fullPath;

  // fsVersion 变化时（删除/重命名/新建后）重读已展开的 children
  useEffect(() => {
    if (!expanded || !node.isDirectory) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    readChildren(node.fullPath)
      .then((c) => { if (!cancelled) setChildren(c); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.fsVersion]);

  const onClick = async () => {
    if (renameMode) return;
    if (!node.isDirectory) {
      onSelect(node.fullPath);
      return;
    }
    if (!expanded && !children && !error) {
      setLoading(true);
      setError(null);
      try {
        setChildren(await readChildren(node.fullPath));
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = node.isDirectory
      ? [
          {
            key: "new-file",
            label: "新建文件",
            onClick: () =>
              ctx.openDialog({
                title: "新建文件",
                hint: "自动追加 .md 后缀",
                onConfirm: async (v) => ctx.onCreateFile(node.fullPath, v),
              }),
          },
          {
            key: "new-dir",
            label: "新建文件夹",
            onClick: () =>
              ctx.openDialog({
                title: "新建文件夹",
                onConfirm: async (v) => ctx.onCreateDir(node.fullPath, v),
              }),
          },
          { key: "s1", separator: true },
          { key: "rename", label: "重命名", onClick: () => setRenameMode(true) },
          {
            key: "del",
            label: "删除",
            danger: true,
            onClick: () => ctx.onDelete(node.fullPath),
          },
        ]
      : [
          { key: "open", label: "打开", onClick: () => onSelect(node.fullPath) },
          { key: "s1", separator: true },
          { key: "rename", label: "重命名", onClick: () => setRenameMode(true) },
          {
            key: "del",
            label: "删除",
            danger: true,
            onClick: () => ctx.onDelete(node.fullPath),
          },
        ];
    ctx.onContext(e, items);
  };

  return (
    <div>
      <div
        className={`tree-row${active ? " active" : ""}`}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <Indents depth={depth} />
        {node.isDirectory ? (
          <span className="tree-chevron">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
        ) : (
          <span className="tree-slot" />
        )}
        <span className="tree-icon">
          {node.isDirectory ? (
            <FolderIcon />
          ) : isMarkdown(node.name) ? (
            <FileMarkdown />
          ) : (
            <FileGeneric />
          )}
        </span>
        {renameMode ? (
          <TreeInput
            defaultValue={node.name}
            onSubmit={async (v) => {
              await ctx.onRename(node.fullPath, v);
              setRenameMode(false);
            }}
            onCancel={() => setRenameMode(false)}
          />
        ) : (
          <span className="tree-name">{node.name}</span>
        )}
      </div>
      {expanded && node.isDirectory && (
        <div>
          {loading ? (
            <div className="tree-empty">
              <Indents depth={depth + 1} />
              <span className="tree-slot" />
              加载中…
            </div>
          ) : error ? (
            <div className="tree-empty">
              <Indents depth={depth + 1} />
              <span className="tree-slot" />
              读取失败：{error}
            </div>
          ) : children && children.length === 0 ? (
            <div className="tree-empty">
              <Indents depth={depth + 1} />
              <span className="tree-slot" />
              (空目录)
            </div>
          ) : (
            children?.map((c) => (
              <TreeNode
                key={c.fullPath}
                node={c}
                currentPath={currentPath}
                depth={depth + 1}
                onSelect={onSelect}
                ctx={ctx}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 输入名浮层（新建文件/文件夹）。重命名走内联 input，不走这里。 */
function PromptDialog({ opts, onClose }: { opts: DialogOpts; onClose: () => void }) {
  const [val, setVal] = useState(opts.value ?? "");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    const v = val.trim();
    if (!v || submitting) return;
    setSubmitting(true);
    try {
      const ok = await opts.onConfirm(v);
      // onConfirm 返回 false 时不关闭（重名等场景保留输入）
      if (ok !== false) onClose();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{opts.title}</div>
        <input
          className="modal-input"
          autoFocus
          value={val}
          placeholder={opts.hint}
          disabled={submitting}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="modal-btn primary" onClick={() => void submit()} disabled={submitting}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  rootDir,
  currentPath,
  fsVersion,
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
  const [roots, setRoots] = useState<Node[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogOpts | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Node[] | null>(null);
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

  // 搜索防抖：非空时 BFS 扫描，空时清空结果
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

  useEffect(() => {
    setRoots(null);
    setError(null);
    if (!rootDir) return;
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
  }, [rootDir, fsVersion]);

  const ctx: TreeCtx = useMemo(
    () => ({
      fsVersion,
      onContext,
      onDelete,
      onRename,
      onCreateFile,
      onCreateDir,
      openDialog: (opts) => setDialog(opts),
    }),
    [fsVersion, onContext, onDelete, onRename, onCreateFile, onCreateDir],
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
        currentPath={currentPath}
        depth={0}
        onSelect={onSelect}
        ctx={ctx}
      />
    ))
  );

  return (
    <aside className="sidebar">
      {/* 工作区头：头像 + 根目录名 + 下拉箭头（点击切换文件夹） */}
      <button
        className="nav-org-selector"
        onClick={onOpenFolder}
        title={rootDir ? `切换文件夹（当前：${rootDir}）` : "打开文件夹"}
      >
        <span className="nav-org-avatar">S</span>
        <span className="nav-org-name">{rootDir ? baseName(rootDir) : "Soul Mark"}</span>
        <ChevronDown className="nav-org-chevron" />
      </button>

      {/* 搜索栏：⌘K 聚焦，实时过滤 md 文件 */}
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
        <span className="nav-search-kbd">{isMac ? "⌘" : "Ctrl"}K</span>
      </div>

      {/* 快捷操作 */}
      <button className="nav-item" onClick={onNewFile}>
        <FileOpenIcon />
        <span>新建文件</span>
        <span className="nav-kbd">{M}N</span>
      </button>
      <button className="nav-item" onClick={onOpenFile}>
        <FileGeneric />
        <span>打开文件</span>
        <span className="nav-kbd">{M}O</span>
      </button>
      <button className="nav-item" onClick={onOpenFolder}>
        <FolderOpenIcon />
        <span>打开文件夹</span>
      </button>

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
                className={`tree-row search-row${currentPath === r.fullPath ? " active" : ""}`}
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

      {/* 底部帮助 */}
      <div className="nav-bottom">
        <button
          className="nav-help"
          title={`快捷键：${M}N 新建 · ${M}O 打开 · ${M}S 保存 · ${M}⇧S 另存为`}
        >
          ?
        </button>
      </div>

      {dialog && <PromptDialog opts={dialog} onClose={() => setDialog(null)} />}
    </aside>
  );
}

export default Sidebar;

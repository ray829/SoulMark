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
function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
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
  onContext,
  onDelete,
  onRename,
  onCreateFile,
  onCreateDir,
}: SidebarProps) {
  const [roots, setRoots] = useState<Node[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogOpts | null>(null);

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

  if (!rootDir) {
    return (
      <aside className="sidebar">
        <div className="sidebar-empty">
          <svg viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h6l2 2h8v14H4z" />
          </svg>
          <p className="empty-text">打开一个文件或文件夹<br />这里会显示文件树</p>
          <div className="sidebar-empty-actions">
            <button className="sidebar-btn primary" onClick={onOpenFolder}>
              打开文件夹
            </button>
            <button className="sidebar-btn" onClick={onOpenFile}>
              打开文件
            </button>
          </div>
        </div>
        {dialog && <PromptDialog opts={dialog} onClose={() => setDialog(null)} />}
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header" title={rootDir}>
        <FolderIcon />
        <span className="root-name">{baseName(rootDir)}</span>
        <button
          className="header-action"
          title="在根目录新建文件"
          onClick={() =>
            setDialog({
              title: "新建文件",
              hint: "自动追加 .md 后缀",
              onConfirm: async (v) => {
                await onCreateFile(rootDir, v);
              },
            })
          }
        >
          <PlusIcon />
        </button>
      </div>
      {fileTree}
      {dialog && <PromptDialog opts={dialog} onClose={() => setDialog(null)} />}
    </aside>
  );
}

export default Sidebar;

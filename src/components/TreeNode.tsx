import { useCallback, useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { message } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  FileGeneric,
  FileMarkdown,
  FolderIcon,
} from "./icons";
import type { MenuItem } from "./ContextMenu";
import { readChildren, shouldReloadChildren, type FileNode, type TreeCtx } from "../hooks/useFileTree";
import { isMarkdown } from "../utils/path";
import { isWindows } from "../utils/platform";

/** "在文件管理器中显示"文案:macOS → Finder,Windows → 资源管理器 */
const REVEAL_LABEL = isWindows ? "在资源管理器中显示" : "在 Finder 中显示";

/** 复制文本到系统剪贴板。静默失败:剪贴板权限异常不应打断用户流程。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 静默忽略 */
  }
}

/** 在系统文件管理器中定位文件/文件夹。失败弹错误框。 */
async function revealInDir(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await message(`无法定位文件：${detail}`, {
      title: "在文件夹中显示",
      kind: "error",
      buttons: { ok: "确定" },
    });
  }
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

/** 内联重命名输入框:Enter 提交、Esc 取消、失焦提交 */
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

export function TreeNode({
  node,
  openPaths,
  depth,
  onSelect,
  ctx,
  pendingRename,
  onRenameDone,
}: {
  node: FileNode;
  openPaths: Set<string>;
  depth: number;
  onSelect: (p: string) => void;
  ctx: TreeCtx;
  /** 外部触发的重命名路径(如新建文件后):匹配本节点时进入编辑态 */
  pendingRename: string | null;
  /** 重命名完成/取消后清除外部 pendingRename */
  onRenameDone: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameMode, setRenameMode] = useState(false);
  const active = openPaths.has(node.fullPath);

  // 外部 pendingRename 命中本节点:进入编辑态(初次渲染即可触发,供新建文件后自动聚焦改名)
  useEffect(() => {
    if (pendingRename && pendingRename === node.fullPath) {
      setRenameMode(true);
      onRenameDone();
    }
  }, [pendingRename, node.fullPath, onRenameDone]);

  /** 统一读取子项入口:首次展开与 fsVersion 刷新共用,避免两套逻辑分叉。 */
  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChildren(await readChildren(node.fullPath));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [node.fullPath]);

  // fsVersion 变化时:已展开的目录按需重读(局部刷新,未受影响子树跳过)。
  // 依赖 fsVersion + fsChange(两者同步变化,同一次 render 内 effect 跑一次)。
  useEffect(() => {
    if (!expanded || !node.isDirectory) return;
    if (!shouldReloadChildren(node.fullPath, ctx.fsChange)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    readChildren(node.fullPath)
      .then((c) => { if (!cancelled) setChildren(c); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ctx.fsVersion, ctx.fsChange, expanded, node.isDirectory, node.fullPath]);

  const onClick = async () => {
    if (renameMode) return;
    if (!node.isDirectory) {
      onSelect(node.fullPath);
      return;
    }
    // 首次展开且无缓存时读取
    if (!expanded && !children && !error) {
      await loadChildren();
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
          { key: "copy-path", label: "复制路径", onClick: () => void copyText(node.fullPath) },
          { key: "reveal", label: REVEAL_LABEL, onClick: () => void revealInDir(node.fullPath) },
          { key: "s2", separator: true },
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
          { key: "copy-path", label: "复制路径", onClick: () => void copyText(node.fullPath) },
          { key: "copy-name", label: "复制文件名", onClick: () => void copyText(node.name) },
          { key: "reveal", label: REVEAL_LABEL, onClick: () => void revealInDir(node.fullPath) },
          { key: "s2", separator: true },
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
              onRenameDone();
            }}
            onCancel={() => {
              setRenameMode(false);
              onRenameDone();
            }}
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
                openPaths={openPaths}
                depth={depth + 1}
                onSelect={onSelect}
                ctx={ctx}
                pendingRename={pendingRename}
                onRenameDone={onRenameDone}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default TreeNode;

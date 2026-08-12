import type React from "react";
import type { MenuItem } from "../components/ContextMenu";
import { listDir } from "../services/fs";
import { isMarkdown, joinPath } from "../utils/path";

/** 文件树节点:目录或 md 文件 */
export interface FileNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
}

/** 新建输入浮层的配置 */
export interface DialogOpts {
  title: string;
  value?: string;
  hint?: string;
  onConfirm: (v: string) => Promise<boolean | void>;
}

/** 透传给每个 TreeNode 的上下文(避免逐个透传 prop) */
export interface TreeCtx {
  fsVersion: number;
  /** 最近受影响的路径集合:null 表示兜底全刷;非空时仅相关目录重读 */
  fsChange: Set<string> | null;
  onContext: (e: React.MouseEvent, items: MenuItem[]) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, name: string) => Promise<boolean>;
  onCreateFile: (dir: string, name: string) => Promise<boolean>;
  onCreateDir: (dir: string, name: string) => Promise<boolean>;
  openDialog: (opts: DialogOpts) => void;
}

/** 读取目录直接子项:隐藏以 . 开头的项,文件夹保留,文件仅显示 md 文档;
 *  文件夹优先 + 字母序(zh locale) */
export async function readChildren(parentPath: string): Promise<FileNode[]> {
  const entries = await listDir(parentPath);
  const nodes: FileNode[] = entries
    .filter((e) => !e.name.startsWith(".") && (e.isDirectory || isMarkdown(e.name)))
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

/** 搜索:BFS 递归扫描 rootDir,收集文件名包含 query 的 md 文件(上限 50) */
export async function searchMarkdown(root: string, query: string, limit = 50): Promise<FileNode[]> {
  const q = query.toLowerCase();
  const results: FileNode[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && results.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await listDir(dir);
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

/** 判断目录是否需要因 fs 变更而重读子项。
 *  - fsChange 为 null:兜底全刷(向后兼容)
 *  - 否则仅当 changed 集合中存在本目录自身或其后代路径时才重读
 *  用途:把删除/重命名/新建的刷新范围收窄到受影响子树,避免全树 readDir。 */
export function shouldReloadChildren(dir: string, fsChange: Set<string> | null): boolean {
  if (!fsChange) return true;
  if (fsChange.has(dir)) return true;
  const prefix = dir.endsWith("/") ? dir : dir + "/";
  for (const p of fsChange) {
    if (p === dir || p.startsWith(prefix)) return true;
  }
  return false;
}

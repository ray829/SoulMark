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

/** 忽略的目录名:体积大且不含用户关注的 md 文档,递归探查时直接跳过。
 *  既是"高效"的关键(跳过 node_modules 等上万文件的目录),也是体验(去除噪声)。 */
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", ".idea", ".vscode",
  "dist", "build", "out", "target", ".next", ".nuxt", ".cache",
  "__pycache__", ".pytest_cache", ".mypy_cache", "venv", ".venv", "env",
  ".gradle", "coverage", ".turbo", ".parcel-cache", "vendor", "Pods",
]);

/** 递归判断目录(含其后代)是否包含 md 文档。
 *
 *  高效策略 —— 早停 + 并发下探:
 *  - 本层直接含 md 文件 → 立即 return true(O(1) 早停);绝大多数含 md 的目录秒判。
 *  - 本层无 md → 并发下探所有非黑名单子目录,任一含 md 即 true。
 *  - 完全不含 md 的目录 → 完整遍历一次后被 readChildren 过滤掉、不再展示,
 *    用户不会展开它 → 天然无重复探查,无需缓存。
 *
 *  保护:
 *  - 深度上限(>MAX_DEPTH 保守返回 true,避免误隐藏深层 md,也防极深递归卡死);
 *  - visited 防符号链接成环导致死循环;
 *  - 黑名单目录直接视为"不含 md",不递归(跳过大目录是提速核心)。 */
const MAX_DEPTH = 15;
async function hasMarkdown(dir: string, depth: number, visited: Set<string>): Promise<boolean> {
  if (depth > MAX_DEPTH || visited.has(dir)) return true; // 过深/成环:保守展示,宁展勿漏
  visited.add(dir);
  let entries;
  try {
    entries = await listDir(dir);
  } catch {
    return false; // 无权限/读取失败:视为不含,不展示
  }
  // 本层直接含 md 文件 → 早停
  for (const e of entries) {
    if (!e.name.startsWith(".") && !e.isDirectory && isMarkdown(e.name)) {
      return true;
    }
  }
  // 本层无 md:并发下探非黑名单子目录,任一含 md 即 true
  const subdirs = entries
    .filter((e) => e.isDirectory && !e.name.startsWith(".") && !IGNORED_DIRS.has(e.name))
    .map((e) => joinPath(dir, e.name));
  if (subdirs.length === 0) return false;
  const results = await Promise.all(
    subdirs.map((sd) => hasMarkdown(sd, depth + 1, visited)),
  );
  return results.some(Boolean);
}

/** 读取目录直接子项:隐藏以 . 开头的项,文件夹保留(并过滤不含 md 的空目录),
 *  文件仅显示 md 文档;文件夹优先 + 字母序(zh locale)。
 *
 *  空目录过滤:对每个子目录调 hasMarkdown 递归判断其子树是否含 md,
 *  不含 md 的目录不返回(不展示)。文件无条件保留。
 *  readChildren 签名不变,TreeNode/Sidebar 零改动,与 fsChange 局部刷新兼容。 */
export async function readChildren(parentPath: string): Promise<FileNode[]> {
  const entries = await listDir(parentPath);
  const nodes: FileNode[] = entries
    .filter((e) => !e.name.startsWith(".") && (e.isDirectory || isMarkdown(e.name)))
    .map((e) => ({
      name: e.name,
      fullPath: joinPath(parentPath, e.name),
      isDirectory: e.isDirectory,
    }));
  // 过滤"子树不含 md 的目录":文件保留,目录需递归判断。每个目录独立 visited 防环。
  const withKeep = await Promise.all(
    nodes.map(async (n) => ({
      node: n,
      keep: n.isDirectory ? await hasMarkdown(n.fullPath, 0, new Set()) : true,
    })),
  );
  const filtered = withKeep.filter((x) => x.keep).map((x) => x.node);
  filtered.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return filtered;
}

/** 搜索缓存:按 (root, fsVersion) 失效的全量 md 文件列表。
 *  首次搜索时递归遍历文件树构建(与原 BFS 同成本),之后同一 fsVersion 内的
 *  每次输入只在内存列表上做字符串过滤(O(n),无 IO),不再重复 readDir 整棵树。
 *  fsVersion 在文件增删/重命名时递增 → 缓存自动失效重建。 */
interface MdListCache {
  root: string;
  version: number;
  files: FileNode[];
}
let mdListCache: MdListCache | null = null;

/** 递归收集目录树下所有 md 文件(跳过黑名单大目录与隐藏项)。 */
async function collectMdFiles(root: string, files: FileNode[]): Promise<void> {
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await listDir(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.name || e.name.startsWith(".")) continue;
      if (e.isDirectory && IGNORED_DIRS.has(e.name)) continue;
      const full = joinPath(dir, e.name);
      if (e.isDirectory) {
        queue.push(full);
      } else if (isMarkdown(e.name)) {
        files.push({ name: e.name, fullPath: full, isDirectory: false });
      }
    }
  }
}

/** 获取全量 md 文件列表(带缓存,按 fsVersion 失效)。 */
async function getMdList(root: string, version: number): Promise<FileNode[]> {
  if (mdListCache && mdListCache.root === root && mdListCache.version === version) {
    return mdListCache.files;
  }
  const files: FileNode[] = [];
  await collectMdFiles(root, files);
  mdListCache = { root, version, files };
  return files;
}

/** 搜索:在缓存的 md 文件列表上过滤文件名包含 query 的项(上限 50)。
 *  首次搜索构建全量列表(递归遍历,与原方案同成本),之后同一 fsVersion 内的
 *  每次输入只做内存字符串过滤,无 IO,大幅加快连续输入的响应。
 *  fsVersion 由调用方传入:文件增删/重命名时递增 → 缓存自动失效重建。 */
export async function searchMarkdown(root: string, query: string, fsVersion: number, limit = 50): Promise<FileNode[]> {
  const q = query.toLowerCase();
  const all = await getMdList(root, fsVersion);
  const results: FileNode[] = [];
  for (const f of all) {
    if (results.length >= limit) break;
    if (f.name.toLowerCase().includes(q)) results.push(f);
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

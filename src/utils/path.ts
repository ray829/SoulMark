/** 路径工具函数（兼容 / 与 \） */

/** 取路径末段文件名（兼容 / 与 \） */
export function baseName(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** 取父目录（兼容 / 与 \），根目录时返回自身 */
export function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx <= 0 ? p : p.slice(0, idx);
}

/** 拼接路径（兼容尾部是否带 /） */
export function joinPath(parent: string, name: string): string {
  return parent.endsWith("/") ? parent + name : parent + "/" + name;
}

/** 判断文件名是否为 Markdown 文档（与 useFile 的过滤器保持一致） */
export function isMarkdown(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

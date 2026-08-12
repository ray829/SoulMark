import { invoke } from "@tauri-apps/api/core";
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

/** 文件系统操作收口层。
 *  所有 fs 调用集中于此:统一错误处理 / 缓存 / 权限边界审计有单一落点。
 *  破坏性删除走后端 safe_remove(拦截家目录 / 系统根),不直连 fs:allow-remove。 */

export const readFile = readTextFile;
export const writeFile = writeTextFile;
export const renamePath = rename;
export const ensureDir = mkdir;
export const pathExists = exists;
export const listDir = readDir;

/** 安全删除:转发到后端 safe_remove command(递归 + 路径校验)。 */
export async function removePath(path: string): Promise<void> {
  await invoke("safe_remove", { path });
}

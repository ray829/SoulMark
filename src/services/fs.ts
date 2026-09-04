import { invoke } from "@tauri-apps/api/core";
import {
  exists,
  mkdir,
  readDir,
  readFile as readBinary,
  readTextFile,
  rename,
  writeFile as writeBinary,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

/** 文件系统操作收口层。
 *  所有 fs 调用集中于此:统一错误处理 / 缓存 / 权限边界审计有单一落点。
 *  破坏性删除走后端 safe_remove(拦截家目录 / 系统根),不直连 fs:allow-remove。 */

export const readFile = readTextFile;
export const writeFile = writeTextFile;
export const renamePath = rename;
/** 确保目录存在(幂等):底层 mkdir 默认非递归,目录已存在会报 os error 17。
 *  包成 recursive:true → 等价 create_dir_all,已存在不报错,契合 ensureDir 语义。 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
export const pathExists = exists;
export const listDir = readDir;
/** 二进制读(图片等),返回 Uint8Array。 */
export const readBinaryFile = readBinary;
/** 二进制写(图片等),接收 Uint8Array。 */
export const writeBinaryFile = writeBinary;

/** 安全删除:转发到后端 safe_remove command(递归 + 路径校验)。 */
export async function removePath(path: string): Promise<void> {
  await invoke("safe_remove", { path });
}

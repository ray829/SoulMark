import { open } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ensureDir } from "./fs";

/** 自定义背景图收口层。
 *  选图 → 拷贝到 appDataDir/backgrounds/bg.<ext> → convertFileSrc 转 webview URL。
 *  存 URL(非 base64)到 localStorage:避免大图撑爆 5MB 配额、拖慢首屏。
 *  appDataDir 路径稳定 + 文件名固定,URL 跨重启有效。 */

const BG_DIR_NAME = "backgrounds";
const SUPPORTED_EXT = ["jpg", "jpeg", "png", "webp", "gif"];

/** 确保背景图存放目录存在,返回其绝对路径。 */
async function ensureBgDir(): Promise<string> {
  const base = await appDataDir();
  const dir = await join(base, BG_DIR_NAME);
  await ensureDir(dir);
  return dir;
}

/** 选择图片并拷贝到 appDataDir/backgrounds/bg.<ext>,返回 webview 可访问 URL。
 *  - 重复选择覆盖上一张(同名 bg.<ext>),避免残留堆积
 *  - 返回 asset URL,由 useSettings 存 localStorage
 *  - 用户取消返回 null
 *  - 拷贝失败抛出,由调用方提示 */
export async function pickBackgroundImage(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "图片", extensions: SUPPORTED_EXT }],
  });
  // open 在 multiple:false 时返回 string | null(单选);多选才是数组
  if (!selected || typeof selected !== "string") return null;

  const ext = (selected.split(".").pop() ?? "jpg").toLowerCase();
  const dir = await ensureBgDir();
  const dest = await join(dir, `bg.${ext}`);
  await copyFile(selected, dest);

  // convertFileSrc:把本地绝对路径转为 webview 可加载的 asset 协议 URL
  // (CSP 已放行 asset:/http://asset.localhost;tauri.conf.json 放行 scope)
  const url = convertFileSrc(dest);
  // 追加版本戳:文件名固定为 bg.<ext>,覆盖后 URL 字符串不变,
  // webview 会命中缓存显示旧图、React state 浅比较也判定未变而不触发渲染
  // (表现:点「更换图片」选了新图,背景却没变)。
  // ?v= 让 URL 每次不同,既绕过 webview 图片缓存,又强制 React 重新渲染;
  // asset 协议用 request.uri().path() 取路径、忽略 query,不影响文件读取。
  return `${url}?v=${Date.now()}`;
}

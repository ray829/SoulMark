/** 本地图片路径 → webview 可访问 URL 解析。
 *
 * 背景:Tauri webview 的页面以 `tauri://localhost`(或 `http://tauri.localhost`)为基准,
 * md 中的相对路径 `./pic.png` 会解析到 webview 自身路径,本地文件系统图片无法直接加载。
 * 方案:仅在渲染层把本地路径转为 asset 协议 URL(convertFileSrc),md 内容保留原始路径,
 * 保存后仍是原始路径(Typora/Obsidian 习惯),不污染文档。
 *
 * 与 Editor 的 sanitizeUrl 协同:sanitizeUrl 拦危险协议,本模块负责本地路径转 URL。
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolve, isAbsolute, dirname, join, basename, extname } from "@tauri-apps/api/path";
import { ensureDir, pathExists, writeBinaryFile } from "../services/fs";

/** 以 web 协议开头(http/https/data/blob)或已是 asset URL 的 src,直接由 webview 加载,无需转换。
 *  幂等关键:convertFileSrc 的输出(asset:/http://asset.localhost)命中本判断,
 *  避免在 MutationObserver 中被反复转换形成死循环。 */
function isWebOrAssetUrl(src: string): boolean {
  const s = src.trim().toLowerCase();
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("data:") ||
    s.startsWith("blob:") ||
    s.startsWith("asset:") ||
    s.startsWith("http://asset.localhost") ||
    s.startsWith("https://asset.localhost")
  );
}

/** 判断是否为 file: 协议 */
function isFileUrl(src: string): boolean {
  return src.trim().toLowerCase().startsWith("file:");
}

/** Windows 盘符路径形如 C:\ 或 C:/ */
function looksLikeWindowsAbsolute(src: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(src.trim());
}

/** 解析图片 src 为 webview 可直接加载的 URL。
 *
 * @param src md 中图片的原始 src 值
 * @param docPath 当前打开的 md 文件绝对路径(无 path 的新建文件传 null/undefined)
 * @returns 可加载的 URL;无法解析(无基准/无 docPath 等)时原样返回 src(裂图)
 */
export async function resolveImageSrc(
  src: string,
  docPath: string | null | undefined,
): Promise<string> {
  if (!src) return src;
  const trimmed = src.trim();
  if (!trimmed) return src;

  // 网络/data/blob/已是 asset URL:原样返回(幂等)
  if (isWebOrAssetUrl(trimmed)) return trimmed;

  try {
    // file:///path/to/img → 提取路径 → convertFileSrc
    if (isFileUrl(trimmed)) {
      let p = trimmed.replace(/^file:\/\//i, "");
      // Windows file:///C:/... 去掉前导斜杠
      if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
      return convertFileSrc(p);
    }

    // 绝对路径(Unix /xxx 或 Windows C:\)
    const isWinAbs = looksLikeWindowsAbsolute(trimmed);
    if (isWinAbs || trimmed.startsWith("/")) {
      // isAbsolute 在 Windows 上对 / 开头可能返回 false,故先用前缀判断兜底
      if (isWinAbs || (await isAbsolute(trimmed))) return convertFileSrc(trimmed);
    }

    // 相对路径:以当前 md 文件目录为基准解析
    if (docPath) {
      const dir = await dirname(docPath);
      const abs = await resolve(dir, trimmed);
      return convertFileSrc(abs);
    }

    // 无 docPath(未保存的新文件):无基准目录,无法解析,原样返回(裂图合理)
    return trimmed;
  } catch {
    // 解析失败:原样返回,保底裂图而非整页崩溃
    return trimmed;
  }
}

/** MIME 类型 → 扩展名(无点)。覆盖常见图片格式,未知类型兜底 png。 */
function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("bmp")) return "bmp";
  if (m.includes("svg")) return "svg";
  if (m.includes("avif")) return "avif";
  return "png";
}

/** 为文件名生成不冲突的唯一名:pic.png → pic-2.png → pic-3.png …
 *  stem=无扩展名主体, ext=含点的扩展名(如 ".png")。 */
async function uniqueName(stem: string, ext: string, dir: string): Promise<string> {
  let name = `${stem}${ext}`;
  let n = 2;
  while (await pathExists(await join(dir, name))) {
    name = `${stem}-${n}${ext}`;
    n++;
  }
  return name;
}

/** 把粘贴/拖拽的图片落盘到 md 同目录的 .assets/ 子目录,返回插入 md 的相对路径。
 *
 * @param source 图片来源:Blob(粘贴截图/拖拽文件)或已存在的文件路径(拖拽,但 webview
 *                File API 通常拿不到完整路径,故主走 Blob)
 * @param docPath 当前 md 文件绝对路径(null/undefined 抛错,需先保存文件)
 * @param fallbackName 无原名时的兜底名(如粘贴截图无文件名),不含扩展名
 * @returns 插入 md 的相对路径,如 `.assets/pic.png`(正斜杠跨平台)
 * @throws docPath 为空时抛错(调用方提示先保存) */
export async function saveImageAsset(
  source: Blob,
  docPath: string | null | undefined,
  fallbackName?: string,
): Promise<string> {
  if (!docPath) {
    throw new Error("当前文件未保存,请先保存后再插入图片");
  }

  const dir = await dirname(docPath);
  const assetsDir = await join(dir, ".assets");
  await ensureDir(assetsDir);

  // 确定文件名 + 扩展名
  // 拖拽的 File 有 name(含扩展),粘贴截图通常无 name → 用 fallbackName + MIME 推断扩展名
  let stem: string;
  let ext: string;
  const fileSource = source as File;
  if (fileSource.name) {
    stem = (await basename(fileSource.name)).replace(/\.[^.]+$/, "") || "image";
    const extNoDot = await extname(fileSource.name);
    ext = extNoDot ? `.${extNoDot}` : `.${mimeToExt(source.type)}`;
  } else {
    stem = fallbackName || `image-${Date.now()}`;
    ext = `.${mimeToExt(source.type)}`;
  }

  const finalName = await uniqueName(stem, ext, assetsDir);
  const finalPath = await join(assetsDir, finalName);

  const bytes = new Uint8Array(await source.arrayBuffer());
  await writeBinaryFile(finalPath, bytes);

  // 返回相对路径(正斜杠跨平台,与 md 标准一致)
  return `.assets/${finalName}`;
}

/** 外链图片代理 URL:把原始外链 URL 转为 imgproxy 自定义协议 URL。
 *
 * Rust 侧 imgproxy 协议 handler 用 reqwest 请求(不发 Origin/Referer 绕防盗链 +
 * .gzip(true) 解强制 gzip),把字节流式作为协议响应体返回。<img> 直连协议 URL,
 * 字节不经 JS 堆/IPC,无 base64 放大、无 objectURL 泄漏,WebView 自动管理位图生命周期。
 *
 * 跨平台:convertFileSrc 第二参指定协议,Tauri 按 macOS/Linux 生成 imgproxy://localhost/<enc>,
 * Windows 生成 http://imgproxy.localhost/<enc>(encodeURIComponent 编码整条 URL 作为 path)。
 */
export function proxyImageSrc(url: string): string {
  return convertFileSrc(url, "imgproxy");
}


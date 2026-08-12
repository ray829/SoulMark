/** 平台检测(集中定义,避免各处重复 navigator 判断)。
 *
 * 注意:navigator.platform 已被规范废弃,但 WebKit(WKWebView)与 WebView2
 * 仍稳定支持,且 Tauri 桌面场景下无 userAgentData。统一收口便于日后迁移。
 * 优先用 userAgentData.platform(Chromium 系),回退 navigator.platform。 */

function detectPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform ?? nav.platform ?? "";
}

function detectUserAgent(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}

const PLATFORM = detectPlatform();
const USER_AGENT = detectUserAgent();

/** macOS(含 iPhone / iPad) */
export const isMac = /Mac|iPhone|iPad/.test(PLATFORM);

/** Windows */
export const isWindows = /Windows/.test(USER_AGENT);

/** 菜单修饰键显示:mac ⌘,其余 Ctrl */
export const modKey = isMac ? "⌘" : "Ctrl";

/** Shift 键显示:mac ⇧,其余 Shift */
export const shiftKey = isMac ? "⇧" : "Shift";

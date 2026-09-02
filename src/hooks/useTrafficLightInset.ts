import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac } from "../utils/platform";

/**
 * macOS 红绿灯避让:把安全左距写入 --traffic-left CSS 变量,供顶栏各元素偏移引用。
 *
 * 三件事落地(参考业界约定,非运行时测像素):
 *  1. 尺寸 —— 用约定值:按钮组宽 52(3×12 + 2×8),左安全边距 8。
 *  2. 位置 —— 不调运行时 API,直接读 tauri.conf.json 里 trafficLightPosition.x(=20):
 *     safeLeft = x(20) + 按钮组(52) + 安全边距(8) = 80。位置是自己配的,读配置即可。
 *  3. 可见性 —— 全屏时红绿灯隐藏,监听窗口 resize(全屏切换必触发)复查 isFullscreen,
 *     全屏则置 0;非 mac / Windows 恒 0。
 *
 * 统一数据源:tauri.conf.json 改 trafficLightPosition.x 时,改此处常量即可联动,
 * 不再有 78/116/156 等散落各处的魔法数。
 */
const TRAFFIC_X = 20; // 对应 tauri.conf.json windows[0].trafficLightPosition.x
const BUTTON_GROUP_W = 52; // macOS 红绿灯三按钮组宽度(3×12 + 2×8)
const SAFE_GAP = 8; // 按钮组右侧到首个可点击元素的安全间隙
const MAC_INSET = TRAFFIC_X + BUTTON_GROUP_W + SAFE_GAP; // = 80

export function useTrafficLightInset() {
  useEffect(() => {
    if (!isMac) {
      document.documentElement.style.setProperty("--traffic-left", "0px");
      return;
    }

    const apply = async () => {
      let inset = MAC_INSET;
      try {
        // 全屏时红绿灯隐藏,无需避让。onResized 在全屏切换时会触发,此处复查状态。
        if (await getCurrentWindow().isFullscreen()) inset = 0;
      } catch {
        /* 查询失败时保守保留避让,不阻塞 UI */
      }
      document.documentElement.style.setProperty("--traffic-left", `${inset}px`);
    };

    void apply();
    // 全屏进入/退出会触发 resize;窗口尺寸变化不影响 inset,但复查代价低,统一处理。
    // 竞态保护:onResized 返回的 Promise 可能在组件卸载后才 resolve,
    // 此时 unlisten 仍为 undefined → cleanup 拿不到 → 订阅泄漏。disposed 标志兜底立即清理。
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    win.onResized(() => void apply()).then((u) => {
      if (disposed) u(); // 卸载先于 resolve:立即清理刚拿到的 unlisten
      else unlisten = u;
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

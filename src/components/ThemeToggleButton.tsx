import { flushSync } from "react-dom";
import { MoonIcon, SunIcon } from "./icons";
import type { ThemeMode } from "../hooks/useSettings";

/* 主题切换按钮:太阳/月亮 SVG 图标,定位在顶栏侧栏切换按钮右侧。
   与 .topbar-toggle-sidebar 同一套样式(30×30 方形圆角、16×16 线条 SVG、hover 灰底)。
   形态由当前主题决定(浅色=太阳,暗色=月亮),点击触发圆形扩散切换主题——
   扩散圆心取按钮几何中心(非 click 点、非屏幕中心),避免点在按钮边缘时圆心偏移。
   flushSync 保证 VT 回调内 DOM 同步更新,新旧快照准确(无闪烁)。
   webview 不支持 startViewTransition 时回退为直接切换。 */

interface ThemeToggleButtonProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  /** mac 下避开原生红绿灯,左移到 toggle 按钮右侧 */
  mac?: boolean;
}

export function ThemeToggleButton({
  theme,
  onToggleTheme,
  mac = false,
}: ThemeToggleButtonProps) {
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 扩散圆心:按钮几何中心(视口坐标)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const root = document.documentElement;
    root.style.setProperty("--theme-tx", `${x}px`);
    root.style.setProperty("--theme-ty", `${y}px`);

    // 切换方向:light→dark 进入暗色(扩散);dark→light 退出暗色(收回)。
    // CSS 据此标记选择动画分支,动画结束后清除(见 transition.finished)。
    root.dataset.themeDir = theme === "light" ? "enter-dark" : "leave-dark";
    const clearDir = () => {
      delete root.dataset.themeDir;
    };

    const apply = () => flushSync(onToggleTheme);
    // bind 锁定 this=document;webview 不支持时回退直接切换
    const startViewTransition = document.startViewTransition?.bind(document);
    if (!startViewTransition) {
      apply();
      clearDir();
      return;
    }
    const transition = startViewTransition(apply);
    // 动画结束(或被中断)后清除方向标记
    transition.finished?.then(clearDir, clearDir);
  };

  return (
    <button
      type="button"
      className={`theme-toggle${mac ? " mac" : ""}`}
      onClick={onClick}
      aria-label={theme === "light" ? "切换到暗色模式" : "切换到浅色模式"}
      title={theme === "light" ? "暗色模式" : "浅色模式"}
    >
      <span className="theme-toggle-icon-stack">
        <SunIcon data-active={theme === "light" ? "" : undefined} />
        <MoonIcon data-active={theme === "dark" ? "" : undefined} />
      </span>
    </button>
  );
}

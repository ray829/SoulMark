import { MoonIcon, SunIcon } from "./icons";
import type { ThemeMode } from "../hooks/useSettings";

/* 主题切换按钮:太阳/月亮 SVG 图标,定位在顶栏侧栏切换按钮右侧。
   与 .topbar-toggle-sidebar 同一套样式(30×30 方形圆角、16×16 线条 SVG、hover 灰底)。
   形态由当前主题决定(浅色=太阳,暗色=月亮),点击切换主题。
   颜色平滑过渡由 App.css 顶部 @property 注册的 <color> 变量自动完成
   (data-theme 变化时全局插值),无需此处做快照/clip-path 动画。 */

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
  return (
    <button
      type="button"
      className={`theme-toggle${mac ? " mac" : ""}`}
      onClick={onToggleTheme}
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

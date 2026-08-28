import { useCallback, useEffect, useState } from "react";

/* 阅读偏好:主题模式、字号、专注模式。
   全部 localStorage 持久化(Tauri webview 原生支持,无需插件)。
   主题解析后写入 <html data-theme>,字号写入 --editor-font-size,
   专注模式给 .app 加 .focus-mode class。 */

export type ThemeMode = "light" | "dark";

const LS_THEME = "soulmark:theme";
const LS_FONT_SIZE = "soulmark:font-size";
const LS_FOCUS_MODE = "soulmark:focus-mode";

/** 字号档位:小 / 中 / 大 */
export const FONT_SIZES = [15, 16, 18] as const;

function readStored<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const v = localStorage.getItem(key);
    return v != null && valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function isThemeMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark";
}

/** 初始默认主题:localStorage 无记录时跟随系统 prefers-color-scheme。
   一旦用户手动切换,记住其选择,不再跟随系统变化。 */
function defaultTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useSettings() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    readStored<ThemeMode>(LS_THEME, defaultTheme(), isThemeMode),
  );
  const [fontSize, setFontSize] = useState<number>(() =>
    readStored<number>(LS_FONT_SIZE, 16, (v): v is number => typeof v === "number" && FONT_SIZES.includes(v as 15 | 16 | 18)),
  );
  const [focusMode, setFocusMode] = useState<boolean>(() =>
    readStored<boolean>(LS_FOCUS_MODE, false, (v): v is boolean => v === "true" || v === "false"),
  );

  // 主题 → <html data-theme> + 持久化
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(LS_THEME, theme);
    } catch {
      /* 忽略存储异常 */
    }
    // 主题变化信号:由调用方联动 Shiki/Mermaid(见 App.tsx)
    window.dispatchEvent(new CustomEvent("soulmark:theme-change", { detail: theme }));
  }, [theme]);

  // 字号 → --editor-font-size
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
    try {
      localStorage.setItem(LS_FONT_SIZE, String(fontSize));
    } catch {
      /* 忽略 */
    }
  }, [fontSize]);

  // 专注模式 → 由 App.tsx 的 className 承载(.focus-mode),此处仅持久化。
  // 不再手动 classList.toggle:React 重渲染会用新 className 覆盖 class 属性,
  // 手动加的 class 会被擦除(如 sidebarCollapsed 变化时),导致 focus-mode 丢失、
  // 专注模式下依赖 .app.focus-mode 的 CSS 规则(含大纲让宽清零)失效。
  useEffect(() => {
    try {
      localStorage.setItem(LS_FOCUS_MODE, String(focusMode));
    } catch {
      /* 忽略 */
    }
  }, [focusMode]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev as 15 | 16 | 18);
      return FONT_SIZES[(idx + 1) % FONT_SIZES.length];
    });
  }, []);

  const toggleFocusMode = useCallback(() => setFocusMode((v) => !v), []);

  return {
    theme,
    fontSize,
    focusMode,
    setTheme,
    setFontSize,
    setFocusMode,
    toggleTheme,
    cycleFontSize,
    toggleFocusMode,
  };
}

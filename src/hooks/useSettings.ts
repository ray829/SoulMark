import { useCallback, useEffect, useState } from "react";

/* 阅读偏好:主题模式、字号、源码模式、自定义背景图 + 毛玻璃。
   全部 localStorage 持久化(Tauri webview 原生支持,无需插件)。
   主题解析后写入 <html data-theme>,字号写入 --editor-font-size。
   背景与毛玻璃参数写 :root CSS 变量(--bg-image/--bg-blur/--bg-dim/
   --glass-blur/--glass-opacity),供 App.css 的 .bg-layer 与各毛玻璃容器消费。 */

export type ThemeMode = "light" | "dark";

const LS_THEME = "soulmark:theme";
const LS_FONT_SIZE = "soulmark:font-size";
const LS_SOURCE_MODE = "soulmark:source-mode";
const LS_BG_IMAGE = "soulmark:bg-image";
const LS_BG_BLUR = "soulmark:bg-blur";
const LS_BG_DIM = "soulmark:bg-dim";
const LS_GLASS_BLUR = "soulmark:glass-blur";
const LS_GLASS_OPACITY = "soulmark:glass-opacity";

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

/** 读取数字型设置并钳制到 [min, max](localStorage 存 string,需 Number 转换)。 */
function readStoredNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  } catch {
    return fallback;
  }
}

/** 读取布尔型设置(localStorage 存 string "true"/"false",需转回布尔,否则 "false" 也是 truthy)。 */
function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

/** 读取字符串型设置(背景图 URL)。 */
function readStoredStr(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v ?? fallback;
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
  const [fontSize, setFontSize] = useState<number>(() => {
    // localStorage 存 string,需 Number 转换后再校验是否在档位内,否则校验恒失败、永远 fallback。
    try {
      const n = Number(localStorage.getItem(LS_FONT_SIZE));
      return FONT_SIZES.includes(n as 15 | 16 | 18) ? n : 16;
    } catch {
      return 16;
    }
  });
  const [sourceMode, setSourceMode] = useState<boolean>(() => readStoredBool(LS_SOURCE_MODE, false));

  // 背景与毛玻璃参数
  const [bgImage, setBgImageState] = useState<string>(() => readStoredStr(LS_BG_IMAGE, ""));
  const [bgBlur, setBgBlur] = useState<number>(() => readStoredNum(LS_BG_BLUR, 0, 0, 40));
  const [bgDim, setBgDim] = useState<number>(() => readStoredNum(LS_BG_DIM, 0.35, 0, 1));
  const [glassBlur, setGlassBlur] = useState<number>(() => readStoredNum(LS_GLASS_BLUR, 8, 0, 32));
  const [glassOpacity, setGlassOpacity] = useState<number>(() =>
    readStoredNum(LS_GLASS_OPACITY, 0.4, 0.4, 1),
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

  // 源码模式 → 仅持久化。显示由 App.tsx 条件渲染 SourceView 控制。
  useEffect(() => {
    try {
      localStorage.setItem(LS_SOURCE_MODE, String(sourceMode));
    } catch {
      /* 忽略 */
    }
  }, [sourceMode]);

  // 背景与毛玻璃 → 写 :root CSS 变量 + 持久化。
  // 各毛玻璃容器经 var() 引用这些变量,实时生效(设置面板调滑块即见预览)。
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--bg-image", bgImage ? `url("${bgImage}")` : "none");
    root.setProperty("--bg-blur", `${bgBlur}px`);
    root.setProperty("--bg-dim", String(bgDim));
    root.setProperty("--glass-blur", `${glassBlur}px`);
    root.setProperty("--glass-opacity", String(glassOpacity));
    try {
      localStorage.setItem(LS_BG_IMAGE, bgImage);
      localStorage.setItem(LS_BG_BLUR, String(bgBlur));
      localStorage.setItem(LS_BG_DIM, String(bgDim));
      localStorage.setItem(LS_GLASS_BLUR, String(glassBlur));
      localStorage.setItem(LS_GLASS_OPACITY, String(glassOpacity));
    } catch {
      /* 忽略 */
    }
  }, [bgImage, bgBlur, bgDim, glassBlur, glassOpacity]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSize((prev) => {
      const idx = FONT_SIZES.indexOf(prev as 15 | 16 | 18);
      return FONT_SIZES[(idx + 1) % FONT_SIZES.length];
    });
  }, []);

  const toggleSourceMode = useCallback(() => setSourceMode((v) => !v), []);

  // 设置背景图 URL(由 background.ts 的 pickBackgroundImage 产出 asset URL;空串清除)
  const setBgImage = useCallback((url: string) => setBgImageState(url), []);

  const resetBackground = useCallback(() => {
    setBgImageState("");
    setBgBlur(0);
    setBgDim(0.35);
    setGlassBlur(8);
    setGlassOpacity(0.4);
  }, []);

  return {
    theme,
    fontSize,
    sourceMode,
    bgImage,
    bgBlur,
    bgDim,
    glassBlur,
    glassOpacity,
    setTheme,
    setFontSize,
    setSourceMode,
    setBgImage,
    setBgBlur,
    setBgDim,
    setGlassBlur,
    setGlassOpacity,
    resetBackground,
    toggleTheme,
    cycleFontSize,
    toggleSourceMode,
  };
}

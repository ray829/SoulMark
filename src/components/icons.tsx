import type { SVGProps } from "react";

/** 统一图标组件(24×24 viewBox,stroke 风格一致)。
 *  集中定义供 App / Sidebar / Welcome 复用,避免逐文件重复绘制同一图标。
 *  WindowControls 的 12×12 窗口按钮图标语义/尺寸不同,保留在其内部不并入。 */
type IconProps = SVGProps<SVGSVGElement>;

const ICON_ATTRS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function PlusIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function FileMarkdown(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.75}>
      {/* 文件折角轮廓:与 FileGeneric 共用,仅中间图案区分类型 */}
      <path d="M6 2.5h7l5 5v11a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 4.5 18.5V4A1.5 1.5 0 0 1 6 2.5z" />
      <path d="M13 2.5V7.5h5" />
      {/* 中间 M 标记:下箭头折线,比纯方框套 M 更精致 */}
      <path d="M8 16v-5.5l2.5 2 2.5-2V16" />
    </svg>
  );
}

export function PanelLeftIcon(props: IconProps) {
  return (
    <svg {...props} viewBox="0 0 1024 1024" fill="currentColor">
      <path d="M740.395 188c88.365 0 160 71.635 160 160v329.347c-0.001 88.365-71.635 159.999-160 160H280c-88.366 0-160-71.635-160-160V348c0-88.365 71.634-160 160-160h460.395zM280 252c-53.019 0-96 42.981-96 96v329.347c0 53.019 42.981 96 96 96h134.051V252H280z m198.051 521.347h262.344c53.019-0.001 95.999-42.981 96-96V348c0-53.019-42.981-96-96-96H478.051v521.347zM337.367 456.266c17.673 0 32 14.326 32 32 0 17.673-14.327 32-32 32H264.33c-17.673-0.001-32-14.327-32-32 0-17.673 14.327-32 32-32h73.037z m0-122.86c17.673 0 32 14.327 32 32 0 17.673-14.327 32-32 32H264.33c-17.673 0-32-14.327-32-32 0-17.673 14.327-32 32-32h73.037z" />
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2.2}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2.2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.75}>
      {/* 圆角文件夹 + accent 轻填充:有体积感,与纯线框文件图标区分 */}
      <path
        d="M3 7a2 2 0 0 1 2-2h3.5l2 2H17a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill="var(--accent)"
        fillOpacity={0.12}
      />
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.75}>
      <path d="M3 18V6h6l2 2h8v2" />
      {/* 翻开的上盖:accent 轻填充,与关闭态文件夹一致区分 */}
      <path d="M6 14l1.5-4.5h13L19 14z" fill="var(--accent)" fillOpacity={0.12} />
      <path d="M3 18h16" />
    </svg>
  );
}

export function FileGeneric(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.75}>
      <path d="M6 2.5h7l5 5v11a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 4.5 18.5V4A1.5 1.5 0 0 1 6 2.5z" />
      <path d="M13 2.5V7.5h5" />
      {/* 中间横线:与 md 的 M 区分,标识"普通文件" */}
      <path d="M8 13h7M8 16h7" strokeLinecap="round" />
    </svg>
  );
}

export function FileOpenIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.75}>
      <path d="M6 2.5h7l5 5v11a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 4.5 18.5V4A1.5 1.5 0 0 1 6 2.5z" />
      <path d="M13 2.5V7.5h5" />
      <path d="M8 13h6M8 16h4" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export function EmptyMark(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.5}>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
      <path d="M9 13h6M9 16h6M9 19h4" />
    </svg>
  );
}

/* ===== 悬浮球操作图标 ===== */

/** 回到顶部:向上箭头 */
export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

/** 浅色模式:太阳 */
export function SunIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** 暗色模式:月亮 */
export function MoonIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** 跟随系统:显示器 */
export function MonitorIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** 字号:大写 A */
export function TypeIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M4 7V5h16v2" />
      <path d="M9 19h6" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** 源码模式:代码尖括号 </> */
export function CodeIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" />
    </svg>
  );
}

/** 设置/工具:齿轮(悬浮球主球图标) */
export function SettingsIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 背景图:图片(山+太阳) */
export function ImageIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

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
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 16V8l3 4 3-4v8" />
    </svg>
  );
}

export function PanelLeftIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
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
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M2 6h6l2 2h12v12H2z" />
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.8}>
      <path d="M6 14l1.5-4.5h13L19 14z" />
      <path d="M3 18V6h6l2 2h8v2" />
      <path d="M3 18h16" />
    </svg>
  );
}

export function FileGeneric(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={2}>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}

export function FileOpenIcon(props: IconProps) {
  return (
    <svg {...props} {...ICON_ATTRS} strokeWidth={1.8}>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
      <path d="M9 14h6M9 17h4" />
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

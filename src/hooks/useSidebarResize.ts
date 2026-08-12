import { useCallback, useRef, useState } from "react";

/** 侧栏宽度范围 */
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 320;

/** 侧栏宽度与收起状态管理 + 拖拽调整。
 *  宽度写入 --sidebar-w CSS 变量,siderbar / 标签对齐共同跟随。
 *  从收起态拖动时先展开,再以记录的宽度继续调整。 */
export function useSidebarResize(initial = 264) {
  const [sidebarWidth, setSidebarWidth] = useState(initial);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarWidthRef = useRef(initial);
  sidebarWidthRef.current = sidebarWidth;

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarCollapsed(false);
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const resizer = e.currentTarget as HTMLElement;
    resizer.classList.add("dragging");
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setSidebarWidth(w);
    };
    const onUp = () => {
      resizer.classList.remove("dragging");
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const effectiveWidth = sidebarCollapsed ? 0 : sidebarWidth;

  return {
    sidebarWidth,
    sidebarCollapsed,
    effectiveWidth,
    setSidebarCollapsed,
    onResizeStart,
  };
}

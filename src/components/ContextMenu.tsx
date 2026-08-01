import { useEffect, useRef } from "react";

/** 一条菜单项。separator=true 时渲染分隔线,其余字段忽略。 */
export interface MenuItem {
  key: string;
  label?: string;
  separator?: boolean;
  /** 危险操作(删除等),文字变红 */
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface ContextMenuProps {
  position: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
}

/**
 * 轻量右键菜单:固定定位浮层,点击外部 / Esc 关闭。
 * 点击菜单项后先 onClose 再触发 onClick。位置自动避开右下溢出。
 * 样式见 App.css 的 .ctx-* 规则。
 */
export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 延迟一帧挂载,避免触发右键的本次 mousedown 立即关闭
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [position, onClose]);

  if (!position) return null;

  // 防溢出:粗估尺寸,超出右/下边时回缩
  const estW = 184;
  const estH = items.length * 30 + 8;
  const x = Math.min(position.x, window.innerWidth - estW - 8);
  const y = Math.min(position.y, window.innerHeight - estH - 8);

  return (
    // portal 到 body 更稳妥,但为保持无依赖直接 fixed;z-index 足够高
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) =>
        it.separator ? (
          <div key={it.key} className="ctx-sep" />
        ) : (
          <button
            key={it.key}
            type="button"
            className={`ctx-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

export default ContextMenu;

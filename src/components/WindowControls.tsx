import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/* ===== Windows 自绘窗口控制按钮(最小化/最大化/关闭) =====
   仅在 Windows(decorations 关闭)下由 App 渲染 */

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2 6h8" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <rect x="2" y="3.5" width="6.5" height="6.5" rx="1" />
      <path d="M4.5 3.5V3a1 1 0 011-1H10a1 1 0 011 1v4.5a1 1 0 01-1 1h-.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  );
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    const refresh = () => {
      void win.isMaximized().then(setMaximized).catch(() => {});
    };
    refresh();
    void win.onResized(refresh).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <div className="win-controls">
      <button
        className="win-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => void win.minimize()}
      >
        <MinimizeIcon />
      </button>
      <button
        className="win-btn"
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        className="win-btn win-close"
        title="关闭"
        aria-label="关闭"
        onClick={() => void win.close()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export default WindowControls;

import { useEffect } from "react";

/** 快捷键:Cmd/Ctrl+S 保存、+Shift 另存为、+O 打开、+N 新建、+W 关闭标签 */
export function useKeyboardShortcuts(handlers: {
  save: () => void;
  saveAs: () => void;
  open: () => void;
  newFile: () => void;
  close: () => void;
}) {
  const { save, saveAs, open, newFile, close } = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) saveAs();
        else save();
      } else if (k === "o") {
        e.preventDefault();
        open();
      } else if (k === "n") {
        e.preventDefault();
        newFile();
      } else if (k === "w") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, saveAs, open, newFile, close]);
}

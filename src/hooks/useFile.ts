import { useCallback, useEffect, useRef, useState } from "react";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { dirname } from "@tauri-apps/api/path";
import type { EditorHandle } from "../components/Editor";
import { baseName, parentDir, joinPath } from "../utils/path";

/** 统一 Markdown 过滤器：与 Sidebar 的 isMarkdown 保持一致 */
const MD_FILTER = { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] };

/** 文件读写失败时的统一错误提示 */
async function showError(operation: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(`${operation}失败：${detail}`, { title: operation, kind: "error" });
}

/**
 * 文件读写 hook：打开 / 保存 / 另存为 / 新建 / 打开文件夹，
 * 以及右键菜单的删除 / 重命名 / 新建文件 / 新建文件夹。
 * 维护当前路径、dirty、根目录（供文件树）、fsVersion（供文件树刷新）。
 */
export function useFile(editorRef: React.RefObject<EditorHandle | null>) {
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [fsVersion, setFsVersion] = useState(0);
  const dirtyRef = useRef(false);

  const bumpFs = useCallback(() => setFsVersion((v) => v + 1), []);

  /** 同步设置 dirty：同时更新 state 和 ref，避免 ref 落后一帧 */
  const setDirtySync = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  useEffect(() => {
    // 仅在 state 被外部意外修改时同步（防御性）
    dirtyRef.current = dirty;
  }, [dirty]);

  // 打开文件后，侧边文件树以该文件所在目录为根。
  // currentPath 为空时（新建文档/删除当前文件）不清空 rootDir，
  // 否则会把整棵文件树抹回空状态——删当前文件后尤其不该这样。
  useEffect(() => {
    if (!currentPath) return;
    dirname(currentPath)
      .then(setRootDir)
      .catch(() => {});
  }, [currentPath]);

  /** Milkdown 内容变化回调：用户真实编辑时置 dirty。
   *  setMarkdown 用 flush=true 重建 state、不产生 transaction，不会误触本回调，故无需抑制标志。 */
  const onMdChange = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  /** 按路径打开文件（文件树点击与 dialog 选择复用）。若有未保存改动先确认。 */
  const openByPath = useCallback(
    async (path: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (dirtyRef.current) {
        const ok = await ask("当前有未保存的修改，是否放弃并打开此文件？", {
          title: "切换文件",
          kind: "warning",
        });
        if (!ok) return;
      }
      try {
        const content = await readTextFile(path);
        editor.setMarkdown(content);
        setCurrentPath(path);
        setDirtySync(false);
      } catch (err) {
        await showError("打开文件", err);
      }
    },
    [editorRef, setDirtySync],
  );

  const openFile = useCallback(async () => {
    const path = await open({ filters: [MD_FILTER] });
    if (typeof path !== "string") return;
    await openByPath(path);
  }, [openByPath]);

  /** 打开文件夹：以所选目录为文件树根（不打开具体文件） */
  const openFolder = useCallback(async () => {
    const dir = await open({ directory: true });
    if (typeof dir !== "string") return;
    setRootDir(dir);
  }, []);

  const saveFile = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const md = editor.getMarkdown();
    let path = currentPath;
    if (!path) {
      path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
      if (!path) return;
    }
    try {
      await writeTextFile(path, md);
      setCurrentPath(path);
      setDirtySync(false);
    } catch (err) {
      await showError("保存文件", err);
    }
  }, [editorRef, currentPath, setDirtySync]);

  const saveAsFile = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const md = editor.getMarkdown();
    const path = await save({ defaultPath: "untitled.md", filters: [MD_FILTER] });
    if (!path) return;
    try {
      await writeTextFile(path, md);
      setCurrentPath(path);
      setDirtySync(false);
    } catch (err) {
      await showError("保存文件", err);
    }
  }, [editorRef, setDirtySync]);

  const newFile = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setMarkdown("");
    setCurrentPath(null);
    setDirtySync(false);
  }, [editorRef, setDirtySync]);

  /** 关闭当前文件：有未保存改动先确认，再清空编辑器与 currentPath。 */
  const closeFile = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (dirtyRef.current) {
      const ok = await ask("当前有未保存的修改，是否放弃并关闭？", {
        title: "关闭文件",
        kind: "warning",
      });
      if (!ok) return;
    }
    editor.setMarkdown("");
    setCurrentPath(null);
    setDirtySync(false);
  }, [editorRef, setDirtySync]);

  /** 删除文件/目录（二次确认，递归删除）。若删的是当前打开的文件，清空编辑器。 */
  const deletePath = useCallback(
    async (path: string) => {
      const ok = await ask(`确定删除 "${baseName(path)}"？此操作不可撤销。`, {
        title: "删除",
        kind: "warning",
      });
      if (!ok) return;
      try {
        await remove(path, { recursive: true });
      } catch (err) {
        await showError("删除", err);
        return;
      }
      if (path === currentPath) newFile();
      bumpFs();
    },
    [currentPath, newFile, bumpFs],
  );

  /** 重命名（撞名检查）。若改的是当前文件，同步更新 currentPath。返回是否成功。 */
  const renamePath = useCallback(
    async (oldPath: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === baseName(oldPath)) return false;
      const newPath = joinPath(parentDir(oldPath), trimmed);
      if (await exists(newPath)) {
        await ask(`"${trimmed}" 已存在，请换个名字。`, {
          title: "重名",
          kind: "warning",
        });
        return false;
      }
      try {
        await rename(oldPath, newPath);
      } catch (err) {
        await showError("重命名", err);
        return false;
      }
      if (oldPath === currentPath) setCurrentPath(newPath);
      bumpFs();
      return true;
    },
    [currentPath, bumpFs],
  );

  /** 在指定目录下新建 Markdown 文件并打开（撞名检查）。 */
  const createFileIn = useCallback(
    async (dir: string, name: string): Promise<boolean> => {
      const raw = name.trim();
      if (!raw) return false;
      const fname = /\.(md|markdown|mdown|mkd|txt)$/i.test(raw) ? raw : `${raw}.md`;
      const path = joinPath(dir, fname);
      if (await exists(path)) {
        await ask(`"${fname}" 已存在，请换个名字。`, {
          title: "重名",
          kind: "warning",
        });
        return false;
      }
      try {
        await writeTextFile(path, "");
      } catch (err) {
        await showError("新建文件", err);
        return false;
      }
      bumpFs();
      await openByPath(path);
      return true;
    },
    [openByPath, bumpFs],
  );

  /** 在指定目录下新建文件夹（撞名检查）。 */
  const createDirIn = useCallback(
    async (dir: string, name: string): Promise<boolean> => {
      const raw = name.trim();
      if (!raw) return false;
      const path = joinPath(dir, raw);
      if (await exists(path)) {
        await ask(`"${raw}" 已存在，请换个名字。`, {
          title: "重名",
          kind: "warning",
        });
        return false;
      }
      try {
        await mkdir(path);
      } catch (err) {
        await showError("新建文件夹", err);
        return false;
      }
      bumpFs();
      return true;
    },
    [bumpFs],
  );

  return {
    currentPath,
    dirty,
    rootDir,
    fsVersion,
    openFile,
    openFolder,
    openByPath,
    saveFile,
    saveAsFile,
    newFile,
    closeFile,
    deletePath,
    renamePath,
    createFileIn,
    createDirIn,
    onMdChange,
  };
}

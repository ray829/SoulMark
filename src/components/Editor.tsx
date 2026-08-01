import { forwardRef, useImperativeHandle, useRef } from "react";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  serializerCtx,
  editorViewCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import "../styles/editor.css";

/** 编辑器对外接口：读取/写入 Markdown 源码 */
export interface EditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  /** 聚焦编辑器并把光标同步到 DOM（view.focus 会触发 selectionToDOM）。 */
  focusEditor: () => void;
}

interface EditorProps {
  initialMarkdown?: string;
  /** 内容被用户编辑时回调（程序化 setMarkdown 触发的不算） */
  onChange?: () => void;
}

const InnerEditor = forwardRef<EditorHandle, EditorProps>(function InnerEditor(
  { initialMarkdown = "", onChange },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);

  const { get } = useEditor((root) => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialMarkdown);
        ctx.get(listenerCtx).markdownUpdated((_ctx, md, prevMd) => {
          if (md !== prevMd) onChange?.();
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener);
    editorRef.current = editor;
    return editor;
  });

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => {
        const editor = get() ?? editorRef.current;
        if (!editor) return "";
        return editor.action((ctx) => {
          const serializer = ctx.get(serializerCtx);
          const view = ctx.get(editorViewCtx);
          return serializer(view.state.doc);
        });
      },
      setMarkdown: (md: string) => {
        const editor = get() ?? editorRef.current;
        if (!editor) return;
        // 用 rAF 等待当前 React commit 与可能的 Modal 卸载后、view DOM
        // 真正可见，view.focus() 内部的 dom.focus 才不会因遮挡失败。
        requestAnimationFrame(() => {
          try {
            editor.action(replaceAll(md, true));
          } catch (e) {
            console.error("[setMarkdown] replaceAll 抛错:", e);
            return;
          }
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.focus();
          });
        });
      },
      focusEditor: () => {
        const editor = get() ?? editorRef.current;
        if (!editor) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.focus();
        });
      },
    }),
    [get],
  );

  return <Milkdown />;
});

export const MarkdownEditor = forwardRef<EditorHandle, EditorProps>(
  function MarkdownEditor(props, ref) {
    return (
      <MilkdownProvider>
        <InnerEditor {...props} ref={ref} />
      </MilkdownProvider>
    );
  },
);

export default MarkdownEditor;

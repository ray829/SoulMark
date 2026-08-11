import { forwardRef, useImperativeHandle, useRef, useEffect } from "react";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  serializerCtx,
  editorViewCtx,
  commandsCtx,
  schemaCtx,
  editorStateOptionsCtx,
  prosePluginsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history, undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { replaceAll } from "@milkdown/kit/utils";
import { EditorState } from "@milkdown/kit/prose/state";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { codeBlockViewPlugin } from "./editor-views/CodeBlockView";
import { shikiHighlightPlugin } from "./editor-views/ShikiHighlightPlugin";
import { mathPlugins } from "./editor-views/MathView";
import { mermaidPlugins } from "./editor-views/MermaidView";
import "katex/dist/katex.min.css";
import "../styles/editor.css";

/** 块级 HTML 标签（需要 display:block 渲染） */
const BLOCK_HTML_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "dd", "dl",
  "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p",
  "pre", "section", "table", "ul", "div", "summary",
]);

/** 从 HTML 字符串中提取第一个标签名 */
function firstTagName(html: string): string {
  const m = html.trim().match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  return m ? m[1].toLowerCase() : "";
}

/** 编辑器对外接口：读取/写入 Markdown 源码 */
export interface EditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  focusEditor: () => void;
  undo: () => void;
  redo: () => void;
}

interface EditorProps {
  initialMarkdown?: string;
  onChange?: () => void;
}

const InnerEditor = forwardRef<EditorHandle, EditorProps>(function InnerEditor(
  { initialMarkdown = "", onChange },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const { get } = useEditor((root) => {
    rootRef.current = root;
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
      .use(listener)
      .use(history)
      .use(codeBlockViewPlugin)
      .use(shikiHighlightPlugin)
      .use(mathPlugins as never)
      .use(mermaidPlugins as never);
    editorRef.current = editor;
    return editor;
  });

  // 后处理：milkdown 的 htmlSchema.toDOM 把 HTML 当 textContent 显示，
  // 这里用 MutationObserver 找到 span[data-type="html"] 节点，改为 innerHTML 真正渲染。
  // 因为 htmlSchema 有 atom:true，ProseMirror 不会重渲染这些节点，DOM 修改持久有效。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const fixHtmlNode = (span: HTMLElement) => {
      if (span.dataset.processed) return;
      const value = span.dataset.value;
      if (!value) return;
      span.innerHTML = value;
      const tag = firstTagName(value);
      if (tag && BLOCK_HTML_TAGS.has(tag)) {
        span.style.display = "block";
      }
      span.dataset.processed = "1";
    };

    root.querySelectorAll<HTMLElement>("span[data-type='html']").forEach(fixHtmlNode);

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLElement) {
            if (node.matches?.("span[data-type='html']")) fixHtmlNode(node);
            node.querySelectorAll("span[data-type='html']").forEach((el) => fixHtmlNode(el as HTMLElement));
          }
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

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
        requestAnimationFrame(() => {
          editor.action((ctx) => {
            // 正常路径:replaceAll(flush=true) 内部 parser + updateState,
            // 用 updateState 重建状态而非 dispatch transaction,
            // 不产生 transaction → 不触发 listener → 不误置 dirty。
            try {
              replaceAll(md, true)(ctx);
            } catch (e) {
              // 降级:parser 抛错(如 "Cannot create node for doc",子节点不满足
              // doc 的 block+ 约束),手动构造 doc > code_block(原文),
              // 同样用 updateState 重建,不产生 transaction,不误置 dirty。
              console.error("[setMarkdown] parser 抛错,降级为代码块:", e);
              try {
                const schema = ctx.get(schemaCtx);
                let inner: any = null;
                if (md.length && schema.nodes.code_block) {
                  inner = schema.nodes.code_block.createChecked({}, schema.text(md));
                }
                if (!inner) inner = schema.nodes.paragraph.createChecked();
                const docNode = schema.nodes.doc.createChecked({}, inner);
                if (docNode) {
                  const view = ctx.get(editorViewCtx);
                  const overrideOptions = ctx.get(editorStateOptionsCtx);
                  const plugins = ctx.get(prosePluginsCtx);
                  view.updateState(
                    EditorState.create(
                      overrideOptions({ schema, doc: docNode, plugins }),
                    ),
                  );
                }
              } catch (e2) {
                console.error("[setMarkdown] 降级失败:", e2);
              }
            }
            try {
              ctx.get(editorViewCtx).focus();
            } catch {
              /* focus 失败忽略 */
            }
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
      undo: () => {
        const editor = get() ?? editorRef.current;
        if (!editor) return;
        editor.action((ctx) => {
          ctx.get(commandsCtx).call(undoCommand.key);
        });
      },
      redo: () => {
        const editor = get() ?? editorRef.current;
        if (!editor) return;
        editor.action((ctx) => {
          ctx.get(commandsCtx).call(redoCommand.key);
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

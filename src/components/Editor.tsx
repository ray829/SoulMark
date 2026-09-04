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
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { EditorState, TextSelection, Plugin } from "@milkdown/kit/prose/state";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { codeBlockViewPlugin } from "./editor-views/CodeBlockView";
import { shikiHighlightPlugin } from "./editor-views/ShikiHighlightPlugin";
import { mathPlugins } from "./editor-views/MathView";
import { mermaidPlugins } from "./editor-views/MermaidView";
import { markPlugins } from "./editor-views/MarkView";
import { selectionTrackerPlugin } from "./editor-views/SelectionTrackerPlugin";
import { SelectionToolbar } from "./SelectionToolbar";
import { sanitizeHtml, sanitizeUrl } from "../utils/sanitize";
import "katex/dist/katex.min.css";
import "../styles/editor.css";

/** GFM 任务列表勾选:Milkdown gfm 的 task list 复用 list_item 节点
 *  (attrs.checked 非 null 即 task 项),toDOM 仅输出 <li data-checked>,
 *  无内置可点击元素。这里用 ProseMirror 的 DOM 事件拦截点击:命中 li 左侧
 *  padding(伪元素 checkbox 占位)区 → setNodeMarkup 翻转 checked。
 *  返回 true 阻止 ProseMirror 把光标移到点击位置(点 checkbox 只切换、不挪光标)。 */
const taskCheckboxPlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          click: (view, event) => {
            const target = event.target;
            if (!(target instanceof Element)) return false;
            const li = target.closest("li[data-checked]");
            if (!li) return false; // 普通 list item 无 data-checked,不处理
            // 仅点击 li 左侧 padding(checkbox 占位)才切换,点文本区照常编辑
            const rect = li.getBoundingClientRect();
            const padLeft = parseFloat(getComputedStyle(li).paddingLeft) || 0;
            if ((event as MouseEvent).clientX - rect.left >= padLeft) return false;
            // li 内容起始 pos = 节点起始 +1,故 li 节点 pos = posAtDOM(li,0) - 1
            let liPos: number;
            try {
              liPos = view.posAtDOM(li, 0) - 1;
            } catch {
              return false;
            }
            const node = view.state.doc.nodeAt(liPos);
            if (!node || node.type.name !== "list_item" || node.attrs.checked == null) return false;
            view.dispatch(
              view.state.tr.setNodeMarkup(liPos, undefined, {
                ...node.attrs,
                checked: !node.attrs.checked,
              }),
            );
            return true;
          },
        },
      },
    }),
);

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

/** 编辑器对外接口：读取/写入 Markdown 源码 + 光标位置存取 */
export interface EditorHandle {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
  focusEditor: () => void;
  undo: () => void;
  redo: () => void;
  /** 读取当前选区位置(anchor/head 为 ProseMirror doc 位置)。无选区返回 null。 */
  getSelection: () => { anchor: number; head: number } | null;
  /** 恢复选区到指定位置(clamp 到 doc.size,失败忽略)。 */
  setSelection: (anchor: number, head: number) => void;
  /** 获取当前 ProseMirror doc 的轻量版本标记(对象引用)。
   *  doc 不可变,任何 transaction 改变内容都会产生新引用,故 await 前后比较引用
   *  即可判断内容是否变化——比 getMarkdown() 序列化快得多(O(1) vs O(n))。
   *  供自动保存检测"写盘期间是否有新输入",避免第二次全量序列化大文档。 */
  getDocVersion: () => unknown;
}

interface EditorProps {
  initialMarkdown?: string;
  onChange?: () => void;
  /** Milkdown 编辑器创建完成后回调一次(供"双击打开文件"等待 editor 就绪)。 */
  onReady?: () => void;
}

const InnerEditor = forwardRef<EditorHandle, EditorProps>(function InnerEditor(
  { initialMarkdown = "", onChange, onReady },
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
      .use(mermaidPlugins as never)
      .use(markPlugins as never)
      .use(taskCheckboxPlugin)
      .use(selectionTrackerPlugin);
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
      // sanitizeHtml:白名单标签 + 剥离 on* / 危险协议,收窄原始 HTML 的 XSS 面。
      // CSP 已挡 inline script,此处为纵深防御(CSS 注入 / UI 伪造)。
      span.innerHTML = sanitizeHtml(value);
      const tag = firstTagName(value);
      if (tag && BLOCK_HTML_TAGS.has(tag)) {
        span.style.display = "block";
      }
      span.dataset.processed = "1";
    };

    // link/image URL 协议清理:剥离 Markdown [x](javascript:…) / ![](javascript:…) 的危险协议。
    // 原始 HTML 块已由 sanitizeHtml 处理,此处覆盖 commonmark link mark / image node 渲染出的 <a>/<img>。
    // 仅改 DOM 不改 doc(ProseMirror 重渲染时用原值,不触发 onMdChange/自动保存),作渲染层纵深防御:
    // CSP script-src 'self' 已拦 javascript: 执行,此处挡 URL 本身,防未来 CSP 放松成存储型 XSS。
    const fixUrlAttr = (el: HTMLElement) => {
      if (el.tagName === "A") {
        const href = el.getAttribute("href");
        if (href != null && href !== sanitizeUrl(href)) el.setAttribute("href", "");
      } else if (el.tagName === "IMG") {
        const src = el.getAttribute("src");
        if (src != null && src !== sanitizeUrl(src)) el.setAttribute("src", "");
      }
    };
    const sanitizeUrlEls = (scope: HTMLElement) => {
      scope.querySelectorAll<HTMLElement>("a[href], img[src]").forEach(fixUrlAttr);
    };

    root.querySelectorAll<HTMLElement>("span[data-type='html']").forEach(fixHtmlNode);
    sanitizeUrlEls(root);

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches?.("span[data-type='html']")) fixHtmlNode(node);
          node.querySelectorAll("span[data-type='html']").forEach((el) => fixHtmlNode(el as HTMLElement));
          // 新增/重渲染的 a/img 同步清理危险协议
          if (node.matches?.("a[href], img[src]")) fixUrlAttr(node);
          sanitizeUrlEls(node);
        }
      }
    });
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // Milkdown editor.create() 异步完成:get() 首次非 null 即视为就绪,触发 onReady。
  // 用 ref 去重保证只触发一次(onReady 引用变化 / strict mode 双调用均安全)。
  // 供"双击 .md 冷启动打开"场景:拿到文件路径时编辑器可能尚未就绪,需等待。
  const readyFiredRef = useRef(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      if (readyFiredRef.current) return;
      if (get()) {
        readyFiredRef.current = true;
        onReady?.();
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [get, onReady]);

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
        // 同步执行(去掉 requestAnimationFrame 包裹):
        // 多 Tab 切换要求 setMarkdown 返回时 editor 状态已更新,
        // 否则快速切换 A→B→C 时 getMarkdown() 会读到旧 tab 内容、误存回错误 tab(内容串台)。
        // flush=true 的 replaceAll 走 updateState 重建、不产生 transaction,不触 listener,不误置 dirty。
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
      getSelection: () => {
        const editor = get() ?? editorRef.current;
        if (!editor) return null;
        let sel: { anchor: number; head: number } | null = null;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { anchor, head } = view.state.selection;
          sel = { anchor, head };
        });
        return sel;
      },
      setSelection: (anchor, head) => {
        const editor = get() ?? editorRef.current;
        if (!editor) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const size = view.state.doc.content.size;
          // clamp 到合法范围:[0, doc.content.size],避免文档变更后位置越界
          const a = Math.max(0, Math.min(anchor, size));
          const h = Math.max(0, Math.min(head, size));
          try {
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, a, h));
            view.dispatch(tr);
            view.focus();
          } catch {
            /* 位置非法(如落在不可选节点上)时忽略,保持默认选区 */
          }
        });
      },
      getDocVersion: () => {
        const editor = get() ?? editorRef.current;
        if (!editor) return null;
        // 返回 doc 引用:不可变,内容变化即产生新引用,O(1) 比较判内容是否变化
        let version: unknown = null;
        editor.action((ctx) => {
          version = ctx.get(editorViewCtx).state.doc;
        });
        return version;
      },
    }),
    [get],
  );

  // 主题切换:重算 Shiki 代码块高亮。
  // setShikiTheme 更新模块级 currentTheme 后派发事件,这里 dispatch 一个
  // force-highlight 的 no-op transaction,触发插件 apply 重算 decoration。
  useEffect(() => {
    const onShikiTheme = () => {
      const editor = get() ?? editorRef.current;
      if (!editor) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta("force-highlight", true));
      });
    };
    window.addEventListener("soulmark:shiki-theme", onShikiTheme);
    return () => window.removeEventListener("soulmark:shiki-theme", onShikiTheme);
  }, [get]);

  return (
    <>
      <Milkdown />
      {/* 选区浮动工具栏:放在 MilkdownProvider 内,get() 可取到编辑器实例。
          createPortal 到 body 的定位逻辑由组件内部处理。 */}
      <SelectionToolbar getEditor={get} />
    </>
  );
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

import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";

/* ===== NodeView:只负责工具栏(语言标签 + 复制按钮)+ contentDOM 容器 =====
   不再做语法高亮 —— 高亮交给 ShikiHighlightPlugin 的 inline Decoration,
   在 ProseMirror 默认 <pre><code> 的同一份文本节点上着色(单层 DOM)。

   【关键】工具栏用纯 DOM 构建,绝不用 React createRoot。
   原因:toolbar 嵌在 ProseMirror 管理的 DOM 树内,React createRoot 的
   异步 reconcile 会产生 childList mutation,被 ProseMirror 的 MutationObserver
   当成"外部篡改 DOM" → flush → updateState → 重建 NodeView → 又 renderToolbar
   → 又 mutation → 死循环(滚动/焦点变化时显形为持续抖动)。
   纯 DOM + 仅在值真正变化时改 textContent,DOM 结构稳定,不触发 mutation。 */

/* 剪贴板(从 App.tsx 迁入) */
function fallbackCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  ta.remove();
}
function copyText(text: string, btn: HTMLButtonElement): void {
  const done = () => {
    const prev = btn.textContent;
    btn.textContent = "已复制";
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {
      fallbackCopy(text);
      done();
    });
  } else {
    fallbackCopy(text);
    done();
  }
}

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private langLabel: HTMLElement;
  private copyBtn: HTMLButtonElement;

  constructor(node: Node) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "code-block-wrap";
    this.dom.setAttribute("data-language", (node.attrs.language as string) || "");

    // 工具栏:纯 DOM,只构建一次。语言标签仅 textContent,复制按钮读最新 node。
    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";
    this.langLabel = document.createElement("span");
    this.langLabel.className = "code-block-lang";
    this.langLabel.textContent = (node.attrs.language as string) || "text";
    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.className = "code-copy";
    this.copyBtn.textContent = "复制";
    this.copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyText(this.node.textContent, this.copyBtn);
    });
    toolbar.appendChild(this.langLabel);
    toolbar.appendChild(this.copyBtn);

    // 代码区:pre > code(contentDOM)。高亮由 decoration 插件注入,
    // 这里只提供与默认 toDOM 一致的容器结构,不参与高亮渲染。
    const pre = document.createElement("pre");
    pre.className = "code-block-pre";
    this.contentDOM = document.createElement("code");
    this.contentDOM.className = "code-block-content";
    (this.contentDOM as HTMLElement).spellcheck = false;
    pre.appendChild(this.contentDOM);

    this.dom.appendChild(toolbar);
    this.dom.appendChild(pre);
  }

  private get language(): string {
    return (this.node.attrs.language as string) || "";
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    const langChanged = (node.attrs.language as string) !== (this.node.attrs.language as string);
    this.node = node;
    // 仅在语言真正变化时改 textContent(结构不变,只在必要时替换文本)。
    // 复制按钮点击时实时读 node.textContent,无需随内容变化重渲染,避免 mutation。
    if (langChanged) {
      this.dom.setAttribute("data-language", this.language);
      this.langLabel.textContent = this.language || "text";
    }
    return true;
  }

  stopEvent(): boolean {
    // contentDOM 内事件交浏览器/ProseMirror 处理(保持可编辑)
    return false;
  }

  destroy(): void {
    // 纯 DOM,无 React root 需 unmount;事件监听随 DOM 移除自动回收
  }
}

/* ===== 注册为 $view:覆盖 code_block 渲染(加工具栏),高亮由独立插件负责 ===== */
export const codeBlockViewPlugin = $view(codeBlockSchema.node, () => (node: Node) => {
  return new CodeBlockView(node);
});

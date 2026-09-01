import { $node, $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* mermaid 节点:匹配 ```mermaid 代码块,渲染为 SVG。
   content:text*, atom,只读(编辑改 mermaid 源码)。 */
const mermaidSchema = $node("mermaid", () => ({
  group: "block",
  atom: true,
  content: "text*",
  code: true,
  selectable: true,
  parseMarkdown: {
    match: (node) => node.type === "code" && (node.lang as string) === "mermaid",
    runner: (state, node, type) => {
      state.openNode(type, {});
      state.addText((node.value as string) || "");
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mermaid",
    runner: (state, node) => {
      state.addNode("code", undefined, node.textContent, { lang: "mermaid" });
    },
  },
  toDOM: () => ["div", { class: "mermaid-block" }, 0],
}));

/* 动态 import mermaid(包大,首屏无 mermaid 时不加载) */
type MermaidModule = typeof import("mermaid");
let mermaidMod: MermaidModule | null = null;
let currentMermaidTheme: "default" | "dark" = "default";

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidMod) {
    const m = await import("mermaid");
    m.default.initialize({ startOnLoad: false, theme: currentMermaidTheme });
    mermaidMod = m;
  }
  return mermaidMod;
}

/* 活跃 mermaid 实例:主题切换时全部重新渲染 */
const activeViews = new Set<MermaidView>();

/** 切换 Mermaid 主题。重新 initialize 并重渲染所有已显示的 mermaid 图。 */
export function setMermaidTheme(resolved: "light" | "dark") {
  currentMermaidTheme = resolved === "dark" ? "dark" : "default";
  if (mermaidMod) {
    mermaidMod.default.initialize({ startOnLoad: false, theme: currentMermaidTheme });
    // 重新渲染所有活跃实例
    for (const v of activeViews) v.rerender();
  }
}

let idCounter = 0;

class MermaidView implements NodeView {
  dom: HTMLElement;
  contentDOM: null = null;
  private node: Node;
  private cancelled = false;

  constructor(node: Node) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "mermaid-block";
    activeViews.add(this);
    void this.render();
  }

  private async render(): Promise<void> {
    const code = this.node.textContent;
    // 同步 fallback(原码),mermaid 加载/渲染前显示
    this.dom.innerHTML = `<pre class="mermaid-fallback"><code>${escapeHtml(
      code,
    )}</code></pre>`;
    try {
      const m = await loadMermaid();
      const id = `mermaid-svg-${++idCounter}`;
      const { svg } = await m.default.render(id, code);
      if (!this.cancelled) this.dom.innerHTML = svg;
    } catch {
      /* keep fallback(语法错误显示原码) */
    }
  }

  /** 主题切换时由 setMermaidTheme 调用,重新渲染 */
  rerender(): void {
    if (!this.cancelled) void this.render();
  }

  update(newNode: Node): boolean {
    if (newNode.type !== this.node.type) return false;
    const changed = newNode.textContent !== this.node.textContent;
    this.node = newNode;
    if (changed) void this.render();
    return true;
  }

  stopEvent(): boolean {
    return true;
  }

  destroy(): void {
    this.cancelled = true;
    activeViews.delete(this);
  }
}

/* 扩展 commonmark 的 code_block:让其 parseMarkdown match 排除 lang==="mermaid"。
   根因:Milkdown parser 按 schema 注册顺序 find 第一个 match。code_block 的 match 是
   `type === "code"`(匹配所有代码块),若先注册会吞掉 ```mermaid,使 mermaid schema 永不命中。
   但把 mermaid 前置又会破坏空文档:ProseMirror 空 doc 的 block+ 默认填充节点会变成 mermaid
   (defaultType 取 next[0],mermaid 前置则排首、无必填 attrs 被选中)→ 空态出现空 mermaid 方块。
   解法:保持 commonmark 在前(空 doc 填充 paragraph 正常),只让 code_block 不匹配 mermaid,
   parser find 跳过 code_block → 继续匹配到 mermaid schema → 图正常渲染。 */
const extendCodeBlockSchema = codeBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const base = prev(ctx);
    return {
      ...base,
      parseMarkdown: {
        match: (node: any) => node.type === "code" && (node.lang as string) !== "mermaid",
        runner: base.parseMarkdown.runner,
      },
    };
  };
});

export const mermaidPlugins = [
  extendCodeBlockSchema,
  mermaidSchema,
  $view(mermaidSchema, () => (node: Node) => new MermaidView(node)),
];

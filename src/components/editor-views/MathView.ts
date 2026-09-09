import { $remark, $node, $view } from "@milkdown/kit/utils";
import remarkMath from "remark-math";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";

/* 注入 remark-math:解析 $...$ → mdast inlineMath,$$...$$ → mdast math */
const remarkMathPlugin = $remark("remarkMath", () => remarkMath, {});

/* 行内公式节点:$...$ (atom, content:text*, 只读渲染) */
const mathInlineSchema = $node("math_inline", () => ({
  group: "inline",
  inline: true,
  atom: true,
  content: "text*",
  selectable: true,
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.openNode(type, {});
      state.addText((node.value as string) || "");
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, node.textContent);
    },
  },
  toDOM: () => ["span", { class: "math-inline" }, 0],
}));

/* 块级公式节点:$$...$$ */
const mathBlockSchema = $node("math_block", () => ({
  group: "block",
  atom: true,
  content: "text*",
  selectable: true,
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => {
      state.openNode(type, {});
      state.addText((node.value as string) || "");
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_block",
    runner: (state, node) => {
      state.addNode("math", undefined, node.textContent);
    },
  },
  toDOM: () => ["div", { class: "math-block" }, 0],
}));

/* 动态加载 katex(包大,首屏无公式时不加载)。
   与 MermaidView 同模式:JS + CSS 一并动态 import(Vite 拆为独立 chunk,
   首屏不阻塞渲染)。原方案顶部静态 import + Editor 静态 import CSS,
   无论文档有无公式都首屏同步加载 256K JS + 28K CSS。 */
type KatexModule = typeof import("katex");
let katexPromise: Promise<KatexModule> | null = null;
function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([m]) => m);
  }
  return katexPromise;
}

/** 用 katex 渲染 LaTeX 为 HTML;渲染抛错时回退显示源码。 */
function renderKatex(katexMod: KatexModule, text: string, displayMode: boolean): string {
  try {
    return katexMod.renderToString(text, { displayMode, throwOnError: false });
  } catch {
    return text;
  }
}

/** 行内公式 NodeView:加载/渲染前显示 LaTeX 源码,异步 katex 就绪后渲染。
 *  generation 防竞态:快速 update 时旧 render 的 await 完成后不回写。 */
class MathInlineView implements NodeView {
  dom: HTMLElement;
  contentDOM: null = null;
  private node: Node;
  private generation = 0;

  constructor(node: Node) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.className = "math-inline";
    void this.render();
  }

  private async render(): Promise<void> {
    const gen = ++this.generation;
    const text = this.node.textContent;
    this.dom.textContent = text; // fallback:加载/渲染前显示源码
    try {
      const katexMod = await loadKatex();
      if (gen !== this.generation) return; // 被新 render 取代
      this.dom.innerHTML = renderKatex(katexMod, text, false);
    } catch {
      /* keep fallback(源码) */
    }
  }

  update(newNode: Node): boolean {
    if (newNode.type !== this.node.type) return false;
    const changed = newNode.textContent !== this.node.textContent;
    this.node = newNode;
    if (changed) void this.render();
    return true;
  }
}

/** 块级公式 NodeView:同 MathInlineView,displayMode=true。 */
class MathBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: null = null;
  private node: Node;
  private generation = 0;

  constructor(node: Node) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "math-block";
    void this.render();
  }

  private async render(): Promise<void> {
    const gen = ++this.generation;
    const text = this.node.textContent;
    this.dom.textContent = text; // fallback
    try {
      const katexMod = await loadKatex();
      if (gen !== this.generation) return;
      this.dom.innerHTML = renderKatex(katexMod, text, true);
    } catch {
      /* keep fallback(源码) */
    }
  }

  update(newNode: Node): boolean {
    if (newNode.type !== this.node.type) return false;
    const changed = newNode.textContent !== this.node.textContent;
    this.node = newNode;
    if (changed) void this.render();
    return true;
  }
}

const mathInlineView = $view(mathInlineSchema, () => (node: Node) => new MathInlineView(node));
const mathBlockView = $view(mathBlockSchema, () => (node: Node) => new MathBlockView(node));

export const mathPlugins = [
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineView,
  mathBlockView,
];

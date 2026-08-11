import { $node, $view } from "@milkdown/kit/utils";
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
async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidMod) {
    const m = await import("mermaid");
    m.default.initialize({ startOnLoad: false, theme: "default" });
    mermaidMod = m;
  }
  return mermaidMod;
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
  }
}

export const mermaidPlugins = [
  mermaidSchema,
  $view(mermaidSchema, () => (node: Node) => new MermaidView(node)),
];

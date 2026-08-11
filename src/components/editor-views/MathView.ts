import { $remark, $node, $view } from "@milkdown/kit/utils";
import remarkMath from "remark-math";
import katex from "katex";

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

/* KaTeX 渲染(只读,contentDOM=null;编辑改 LaTeX 源码) */
function renderKatex(text: string, displayMode: boolean): string {
  try {
    return katex.renderToString(text, { displayMode, throwOnError: false });
  } catch {
    return text;
  }
}

const mathInlineView = $view(mathInlineSchema, () => (node) => {
  const dom = document.createElement("span");
  dom.className = "math-inline";
  dom.innerHTML = renderKatex(node.textContent, false);
  return {
    dom,
    contentDOM: null,
    update: (newNode) => {
      if (newNode.type !== node.type) return false;
      dom.innerHTML = renderKatex(newNode.textContent, false);
      return true;
    },
  };
});

const mathBlockView = $view(mathBlockSchema, () => (node) => {
  const dom = document.createElement("div");
  dom.className = "math-block";
  dom.innerHTML = renderKatex(node.textContent, true);
  return {
    dom,
    contentDOM: null,
    update: (newNode) => {
      if (newNode.type !== node.type) return false;
      dom.innerHTML = renderKatex(newNode.textContent, true);
      return true;
    },
  };
});

export const mathPlugins = [
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineView,
  mathBlockView,
];

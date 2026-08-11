/* ===== 代码块语法高亮:ProseMirror inline Decoration 方案 =====
   单层 DOM:ProseMirror 在默认 <pre><code> 里渲染文本节点,本插件只给每个
   token 加 inline decoration(color),文本与颜色在同一层 → 不存在两层
   对齐问题 → 不会因高亮产生高度跳变/抖动。

   对比已废弃的"grid 双层叠加"方案(高光层 + contentDOM 叠在同一格):
   - 双层方案要求两层像素级对齐,异步高亮替换 innerHTML / 聚焦失焦切换时
     高度只要有 1px 差异,grid 单元格就跳变,整篇文档跟着抖。
   - 本方案 decoration 只改 color,不改布局,高度恒定。 */

import { $proseAsync } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { findChildren } from "@milkdown/kit/prose";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { createHighlighter, type Highlighter } from "shiki";
import type { Node as PmNode } from "@milkdown/kit/prose/model";
import type { Ctx } from "@milkdown/kit/ctx";

/* Shiki highlighter 单例:首次 await 加载主题 + 语言包,之后同步复用。
   主题用 github-light,配合应用浅色 UI(github-dark 的 token 色在浅底上不可读)。 */
let hlPromise: Promise<Highlighter> | null = null;
function getHL(): Promise<Highlighter> {
  if (!hlPromise) {
    hlPromise = createHighlighter({
      themes: ["github-light"],
      langs: [
        "javascript", "typescript", "jsx", "tsx", "python", "go", "rust",
        "json", "bash", "markdown", "sql", "css", "html", "yaml", "java",
        "c", "cpp",
      ],
    });
  }
  return hlPromise;
}

const highlightKey = new PluginKey("shiki-highlight");

/* 遍历 doc 中所有 code_block,对每个块的文本做 token 化,
   用 inline decoration 给每个 token 染色。
   pos 从 block.pos+1 起算(block 节点起始位置 +1 进入内部文本),
   并对 textEnd 做 clamp,防止尾随换行导致的越界 decoration。 */
function buildDecorations(
  ctx: Ctx,
  doc: PmNode,
  hl: Highlighter,
): DecorationSet {
  const codeBlockType = codeBlockSchema.type(ctx);
  const blocks = findChildren((n) => n.type === codeBlockType)(doc);
  const decorations: Decoration[] = [];

  for (const block of blocks) {
    const text = block.node.textContent;
    if (!text) continue;

    const language = (block.node.attrs.language as string) || "";
    const loaded = hl.getLoadedLanguages();
    const lang = language && loaded.includes(language) ? language : "";
    if (!lang) continue; // 无语言或语言包未加载:不着色,退化为普通文本(不抖动)

    const textStart = block.pos + 1; // code_block 起始标记占 1,内部文本从 +1 起
    const textEnd = textStart + text.length;
    let pos = textStart;

    try {
      // lang 已由 getLoadedLanguages() 运行时校验,断言为 shiki 期望的字面量联合类型
      const { tokens } = hl.codeToTokens(text, {
        lang: lang as never,
        theme: "github-light",
      });
      for (const line of tokens) {
        for (const token of line) {
          const len = token.content.length;
          if (len > 0 && pos + len <= textEnd) {
            decorations.push(
              Decoration.inline(pos, pos + len, {
                style: `color: ${token.color}`,
              }),
            );
          }
          pos += len;
        }
        pos += 1; // 行间换行符占 1
      }
    } catch {
      /* 单块 token 化失败跳过,不影响其他块 */
    }
  }

  return DecorationSet.create(doc, decorations);
}

/* $proseAsync:先 await highlighter 就绪,再返回 Plugin。
   插件 state 在 init 与 docChanged 时重算 decoration;非 docChanged
   (选区变化)直接返回原 value,避免对 26+ 个代码块做无谓 map/重算。 */
export const shikiHighlightPlugin = $proseAsync(async (ctx) => {
  const hl = await getHL();
  return new Plugin({
    key: highlightKey,
    state: {
      init: (_, { doc }) => buildDecorations(ctx, doc, hl),
      apply: (tr, value) => {
        if (tr.docChanged) {
          return buildDecorations(ctx, tr.doc, hl);
        }
        // 选区/存储标记变化:decoration 位置不变,直接复用
        return value;
      },
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
    },
  });
});

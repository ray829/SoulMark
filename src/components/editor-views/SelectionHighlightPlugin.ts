import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const selectionHighlightKey = new PluginKey("selectionHighlight");

/* 选区高亮插件:用 inline decoration 精确涂色选区文本范围,替代原生 ::selection。
 * 问题:原生 ::selection 在跨段选区时会「填充」块间 margin 间隙,视觉上段落之间
 *   的空白也被选中高亮,与上下文字高亮割裂(空段落已用 p:has(>br:only-child)
 *   ::selection 透明处理,但非空段落间的 margin 间隙仍被涂色)。
 * 方案:把 .ProseMirror ::selection 设为透明,改用 ProseMirror inline decoration
 *   只覆盖选区内的文本节点范围(selection.from → to)。Decoration.inline 跨块时
 *   按块内文本分段应用,块间 DOM 边界(无文本节点)不被涂色 → 仅文字高亮,块间
 *   间隙不涂。
 * 实时性:decorations 在每次 state 变化(含选区变化)时重算,与原生选区同步无延迟。
 * 空选区(光标折叠态)返回 null,不高亮,符合预期。 */
export const selectionHighlightPlugin = $prose(
  () =>
    new Plugin({
      key: selectionHighlightKey,
      props: {
        decorations(state) {
          const { selection } = state;
          if (selection.empty) return null;
          return DecorationSet.create(state.doc, [
            Decoration.inline(selection.from, selection.to, {
              class: "selection-highlight",
            }),
          ]);
        },
      },
    }),
);

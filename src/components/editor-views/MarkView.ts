import { $remark, $markAttr, $markSchema, $command, $inputRule, $useKeymap } from "@milkdown/kit/utils";
import { markRule } from "@milkdown/kit/prose";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { commandsCtx } from "@milkdown/kit/core";
import { remarkHighlightMark } from "remark-highlight-mark";

/* 高亮 mark:==text== 语法。整体与 gfm 的 strike(~~text~~) 同构 ——
   - remark-highlight-mark: 解析 ==text== → mdast highlight 节点(含 toMarkdown 闭环,
     保存时序列化回 ==text==,读写一致)。
   - $markSchema: mdast highlight ↔ ProseMirror highlight mark,渲染为 <mark>。
   - $inputRule: 行内输入 ==text== 自动转 mark。
   - $command + $useKeymap: Mod-Alt-h 切换高亮(供工具栏/快捷键复用)。 */

/* 注入 remark-highlight-mark:==text== → mdast highlight 节点 */
const remarkHighlightMarkPlugin = $remark("remarkHighlightMark", () => remarkHighlightMark as never, {});

/* mark 属性(默认空 attrs,与 strike 的 $markAttr 一致,供未来扩展) */
const highlightAttr = $markAttr("highlight");

/* 高亮 mark schema:==text== 渲染为 <mark> */
const highlightSchema = $markSchema("highlight", (ctx) => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: (mark) => ["mark", ctx.get(highlightAttr.key)(mark)],
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => {
      state.withMark(mark, "highlight");
    },
  },
}));

/* toggle 命令:切换高亮。导出供选区浮动工具栏复用。 */
export const toggleHighlightCommand = $command("ToggleHighlight", (ctx) => () => {
  return toggleMark(highlightSchema.type(ctx));
});

/* 输入规则:输入 ==text== 自动转高亮 mark(正则与 strike 同构,~ 换 ==) */
const highlightInputRule = $inputRule((ctx) => {
  return markRule(/(?<![\w:/])(==)(.+?)\1(?!\w|\/)/, highlightSchema.type(ctx));
});

/* 快捷键 Mod-Alt-h 切换高亮 */
const highlightKeymap = $useKeymap("highlightKeymap", {
  ToggleHighlight: {
    shortcuts: "Mod-Alt-h",
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleHighlightCommand.key);
    },
  },
});

/* $markSchema / $useKeymap 返回数组,flat 展开后注册(与 gfm preset 同构) */
export const markPlugins = [
  remarkHighlightMarkPlugin,
  highlightAttr,
  highlightSchema,
  toggleHighlightCommand,
  highlightInputRule,
  highlightKeymap,
].flat();

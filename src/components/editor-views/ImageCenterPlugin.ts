import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

/* 图片段落居中插件:给"仅含图片、无文字"的段落打 img-only-para class,供 CSS text-align:center 居中。
 *
 * 背景:图片改 inline-block 后(光标落图右侧),margin-inline:auto 失效(仅 block 才 auto 居中),
 * 图片默认左对齐。需居中时,纯 CSS :has() 无法识别"段落无文字"(text node 不命中 :has),
 * 故用 ProseMirror decoration 在渲染层给段落打标记。
 *
 * 判定:段落(textblock)所有子节点均为 image 节点(atom inline),无 text node。
 *   覆盖:单图 ![](url)、多图 ![](a)![](b)(无文字)。
 *   不覆盖:text![](url)(有文字,inline 流正常,无需居中)。
 *
 * Decoration.node 的 class 由 ProseMirror combineAttrs 拼接(空格分隔),不覆盖段落已有 class。
 * decorations(state) 在每个 transaction 重算,state 驱动,与 imageCodePlugin /
 * selectionHighlightPlugin 同构。image 为 commonmark inline atom node。
 */

export const imageCenterKey = new PluginKey("imageCenter");

function isImageOnlyParagraph(node: { isTextblock: boolean; childCount: number; child: (i: number) => any }): boolean {
  if (!node.isTextblock || node.childCount === 0) return false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.isText) return false; // 有文字 → 不标记(inline 流居中无意义)
    if (child.type.name !== "image") return false; // 含其他 inline 节点 → 不标记
  }
  return true;
}

export const imageCenterPlugin = $prose(
  () =>
    new Plugin({
      key: imageCenterKey,
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (isImageOnlyParagraph(node)) {
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "img-only-para" }));
            }
            return true;
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    }),
);

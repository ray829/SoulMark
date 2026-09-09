import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, NodeSelection } from "@milkdown/kit/prose/state";

/* 图片单击选中插件:点击 image node 时主动建 NodeSelection。
 *
 * 背景:ProseMirror 默认 handleClick 仅对 leaf block node 建 NodeSelection,
 * 对 inline atom node(如 commonmark image:inline:true, atom:true)默认建文本选区,
 * 不会选中图片节点。这导致"单击选中图片"的交互不可靠。
 *
 * 此插件在 handleClick 中检测点击位置是否落在 image node 上(view.domAtPos 返回的节点
 * 是 <img> 或其最近父级含 image 节点),若是则 dispatch NodeSelection.create(pos),
 * 选中该图片节点(配合 .ProseMirror-selectednode 边框高亮 + imageCodePlugin 文档流源码行)。
 * 选中后按 → 方向键,光标移到图后(ProseMirror 标准行为)。
 *
 * 与 imageDropPlugin / selectionTrackerPlugin 同构($prose 工厂)。
 */

export const imageSelectKey = new PluginKey("imageSelect");

export const imageSelectPlugin = $prose(
  () =>
    new Plugin({
      key: imageSelectKey,
      props: {
        handleClick(view, pos, event) {
          // 只处理点击到 <img> 的情况:从 DOM 节点向上找 img。
          const target = event.target as HTMLElement | null;
          const img = target?.closest?.("img") as HTMLImageElement | null;
          if (!img) return false;
          // 找到 img 对应的 doc 位置:用 posAtDOM 反查(若失败回退到传入 pos)。
          let imgPos = pos;
          try {
            const found = view.posAtDOM(img, 0);
            if (found != null) imgPos = found;
          } catch {
            /* posAtDOM 失败则用 pos */
          }
          // 在 imgPos 处尝试建 NodeSelection:仅当该位置确实是 image node 时。
          const $pos = view.state.doc.resolve(imgPos);
          const node = $pos.nodeAfter;
          if (node && node.type.name === "image") {
            const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos));
            view.dispatch(tr);
            return true; // 拦截默认(防止建文本选区),由我们建 NodeSelection
          }
          return false;
        },
      },
    }),
);

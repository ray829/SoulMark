import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

/* 图片源码行 + 放大按钮插件:选中 image node(NodeSelection)时,在图片正上方文档流内
 * 插入 `![alt](src)` 可编辑单行 + 放大预览按钮(Decoration.widget)。
 *
 * 背景:旧方案(ImageEditBar)用 createPortal+position:fixed 悬浮输入框 + 悬停放大按钮,
 *   依赖 view.hasFocus() 控制显隐;SelectionTrackerPlugin 在 blur 时派发
 *   soulmark:selection-change({empty}),导致用户把鼠标移到输入框准备编辑时
 *   编辑器失焦 → 源码行立即消失,无法编辑。
 *
 * 本方案:widget 显隐完全由 ProseMirror selection state 驱动,decorations(state)
 *   只在 transaction 时重算;blur 不产生 transaction → widget 保持 → 失焦免疫。
 *   widget spec 的 stopEvent:()=>true 让 ProseMirror 忽略来自 widget 的 DOM 事件
 *   (不移动选区),ignoreSelection:true 不把 DOM 选区同步回 state —— input 可聚焦
 *   编辑且不丢 NodeSelection。两字段见 prosemirror-view@1.42.1 widget spec 类型定义。
 *
 * 放大按钮:与源码行同处一个 widget(选中图片时一并出现),点击 → getOnPreview() →
 *   App 层 setPreview 打开 lightbox。click 时用 view.domAtPos(imgPos) 读当前 DOM 上 img
 *   的 src(已 resolve 本地路径 / 已 proxy 外链),而非 node.attrs.src(原始 md src),
 *   因 lightbox 的 <img> 直接用此 src 不再 resolve —— 传原始相对路径/防盗链外链会裂图。
 *
 * 文档流:widget 是 ProseMirror 管理的 DOM,渲染在图片之前(<p> 内图片的上一兄弟节点),
 *   即图片正上方,跟随滚动、占位,非 fixed 浮层,Typora 式就地源码行。
 *
 * 纯 DOM:遵循 CodeBlockView 警告,NodeView/widget 内禁用 React createRoot
 *   (会触发 ProseMirror MutationObserver 死循环)。事件监听随 DOM 移除自动回收。
 *   放大按钮的 SVG 与 icons.tsx 的 ICON_ATTRS 同款(24×24 viewBox,stroke=currentColor,
 *   round linecap/linejoin),保持项目图标视觉一致。
 *
 * 与 taskCheckboxPlugin(同款 Decoration.widget)、SelectionHighlightPlugin(同款
 *   decorations(state))、updateImageCommand(内部即 setNodeMarkup+scrollIntoView)
 *   同构。image 为 commonmark inline atom node,nodeSize=1。
 */

export const imageCodeKey = new PluginKey("imageCode");

export type ImagePreviewFn = (img: { src: string; alt: string }) => void;

/** 解析 `![alt](src)` 字符串 → {alt, src}。失败返回 null。与旧 ImageEditBar 同款正则。 */
function parseMdImage(s: string): { alt: string; src: string } | null {
  const m = s.match(/^!\[([^\]]*)\]\(([^)\s]*)\)\s*$/);
  if (!m) return null;
  return { alt: m[1], src: m[2] };
}

/** 放大预览图标 SVG(expand:四角向内箭头,表示放大全屏)。
 *  与 icons.tsx ICON_ATTRS 同款:24×24 viewBox,fill=none,stroke=currentColor,round。 */
const ZOOM_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

export function imageCodePlugin(getOnPreview: () => ImagePreviewFn | undefined) {
  return $prose(
    () =>
      new Plugin({
        key: imageCodeKey,
        props: {
          decorations(state) {
            const sel = state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") {
              return null;
            }
            const node = sel.node;
            const imgPos = sel.from;
            // widget 插在图片节点之前(sel.from, side:-1),DOM 顺序 [源码行][图片],
            // 源码行显示在图片正上方。若放图片后(side:1 at imgPos+1),会挤进两图之间
            // 撑大间距,且提交后光标落在图片与源码行之间(视觉卡在图片下方)。
            const widgetPos = sel.from;
            const src = (node.attrs.src as string) ?? "";
            const alt = (node.attrs.alt as string) ?? "";

            return DecorationSet.create(state.doc, [
              Decoration.widget(
                widgetPos,
                // toDOM 签名为 (view, getPos) => Node;view 类型自动推断为 ProseMirror EditorView。
                // 闭包捕获 imgPos/src/alt 预填。稳定 key 使 pos 不变时复用 widget DOM、不重调 toDOM,
                // input 值在自动保存/主题切换等 transaction 后不丢失;切换图片(pos 变)才重建预填新值。
                (view) => {
                  const container = document.createElement("div");
                  container.className = "md-image-code-row";
                  // widget 在 contenteditable 的 .milkdown 内,容器声明不可编辑,避免被当成正文节点
                  container.setAttribute("contenteditable", "false");

                  const input = document.createElement("input");
                  input.className = "md-image-code-input";
                  input.type = "text";
                  input.spellcheck = false;
                  input.value = `![${alt}](${src})`;
                  input.setAttribute("aria-label", "编辑图片语法");
                  // 阻止 input mousedown 冒泡到编辑器(双保险:stopEvent 已忽略事件,这里再挡一道)
                  input.addEventListener("mousedown", (e) => e.stopPropagation());

                  input.addEventListener("keydown", (e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      const parsed = parseMdImage(input.value);
                      if (!parsed) return; // 解析失败:保持 widget 可见,用户可修正
                      const st = view.state;
                      const cur = st.selection;
                      if (!(cur instanceof NodeSelection) || cur.node.type.name !== "image") return;
                      const imgNode = cur.node;
                      // 合并 src/alt,保留其余 attrs(如 title);与 updateImageCommand 等价
                      const newAttrs = { ...imgNode.attrs, src: parsed.src, alt: parsed.alt };
                      let tr = st.tr.setNodeMarkup(imgPos, undefined, newAttrs);
                      // 提交后光标移到图后(imgPos+1,atom nodeSize=1),选区变 TextSelection → widget 移除
                      try {
                        tr = tr.setSelection(TextSelection.create(st.doc, imgPos + 1));
                      } catch {
                        /* 落点非法时仅更新 attrs,保留选区(widget 仍在) */
                      }
                      view.dispatch(tr.scrollIntoView());
                      view.focus();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      const st = view.state;
                      let tr = st.tr;
                      try {
                        tr = tr.setSelection(TextSelection.create(st.doc, imgPos + 1));
                      } catch {
                        /* 落点非法时不改选区 */
                      }
                      view.dispatch(tr.scrollIntoView());
                      view.focus();
                    }
                  });

                  // 放大预览按钮:与源码输入框同处一行(选中图片时出现)。
                  // mousedown 读当前 DOM img 的 src(已 resolve/proxy)→ getOnPreview() → lightbox。
                  const zoomBtn = document.createElement("button");
                  zoomBtn.type = "button";
                  zoomBtn.className = "md-image-zoom-btn";
                  zoomBtn.title = "放大预览";
                  zoomBtn.setAttribute("aria-label", "放大预览");
                  zoomBtn.innerHTML = ZOOM_ICON_SVG;
                  zoomBtn.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    let url = src;
                    let altText = alt;
                    try {
                      // domAtPos(imgPos) 落在 img 起始,通常返回 img 元素;非 img 时向下查 img。
                      const found = view.domAtPos(imgPos);
                      const el = found.node as HTMLElement;
                      const imgEl =
                        el.nodeType === 1 && el.tagName === "IMG"
                          ? (el as HTMLImageElement)
                          : (el.querySelector?.("img") as HTMLImageElement | null);
                      if (imgEl) {
                        url = imgEl.getAttribute("src") ?? url;
                        altText = imgEl.getAttribute("alt") ?? altText;
                      }
                    } catch {
                      /* domAtPos 失败则用闭包 src/alt(原始 md src,可能裂图,保底) */
                    }
                    getOnPreview()?.({ src: url, alt: altText });
                  });

                  container.appendChild(input);
                  container.appendChild(zoomBtn);
                  return container;
                },
                {
                  // side:-1 → widget 排在 imgPos 之前(DOM 上方),即图片正上方显示源码行。
                  // 忽略来自 widget 的事件 + 不同步 DOM 选区 → input 可聚焦编辑不丢 NodeSelection
                  side: -1,
                  key: `image-code-${widgetPos}`,
                  stopEvent: () => true,
                  ignoreSelection: true,
                },
              ),
            ]);
          },
        },
      }),
  );
}

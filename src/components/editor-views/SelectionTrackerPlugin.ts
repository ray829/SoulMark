import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

/* 选区跟踪插件:与 taskCheckboxPlugin 同构($prose 工厂)。
 * 作用:把 ProseMirror 内部的 selection 变化桥接到 window 自定义事件,
 *   供 React 侧的 SelectionToolbar 订阅(与 shiki-theme 事件桥接模式一致)。
 * 设计要点:
 *  - 不在 apply 里读 DOM 坐标:apply 执行时视图尚未重绘,coordsAtPos 会读到旧位置。
 *    这里只在 view.update(view 已重绘)派发事件,React 侧再 rAF 取坐标。
 *  - 闭包去重:只在 {from,to,empty} 三元组真正变化时派发,避免打字时(折叠选区不变)
 *    高频触发 React 重渲染。storedMarks 变化不算选区变化(工具栏 active 态由
 *    selection 改变或命令执行后的 transaction 驱动刷新)。
 */
export const selectionKey = new PluginKey("selectionTracker");

interface SelSnap {
  from: number;
  to: number;
  empty: boolean;
}

export const selectionTrackerPlugin = $prose(
  () =>
    new Plugin({
      key: selectionKey,
      state: {
        init: (): SelSnap => ({ from: 0, to: 0, empty: true }),
        apply(tr, prev: SelSnap): SelSnap {
          const sel = tr.selection;
          if (sel.from === prev.from && sel.to === prev.to && sel.empty === prev.empty) {
            return prev;
          }
          return { from: sel.from, to: sel.to, empty: sel.empty };
        },
      },
      view(view) {
        // 记录上次派发的三元组,与 plugin state 配合做二级去重:
        // plugin state 在 transaction 未改变选区时引用不变,但 view.update 仍可能被
        // 其它插件触发,这里再挡一道,确保事件只在选区真正变化时发出。
        let last: SelSnap | null = null;
        const dispatch = (snap: SelSnap) => {
          if (last && last.from === snap.from && last.to === snap.to && last.empty === snap.empty) {
            return;
          }
          last = { from: snap.from, to: snap.to, empty: snap.empty };
          window.dispatchEvent(
            new CustomEvent("soulmark:selection-change", {
              detail: { from: snap.from, to: snap.to, empty: snap.empty },
            }),
          );
        };
        // 编辑器失焦时派发 empty:ProseMirror selection 不因 blur 消失,但工具栏应隐藏。
        // 用 capture blur(view.dom 是 contenteditable,blur 不冒泡,capture 可捕获)。
        // 点击工具栏按钮的 mousedown 已 preventDefault,不会触发此处 blur,安全。
        const onBlur = () => dispatch({ from: 0, to: 0, empty: true });
        view.dom.addEventListener("blur", onBlur, true);
        return {
          update: (v) => {
            const snap = selectionKey.getState(v.state) as SelSnap | undefined;
            if (!snap) return;
            dispatch(snap);
          },
          destroy: () => {
            view.dom.removeEventListener("blur", onBlur, true);
            last = null;
          },
        };
      },
    }),
);

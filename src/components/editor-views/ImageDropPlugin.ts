import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";

/* 粘贴/拖拽图片拦截插件:与 selectionTrackerPlugin / taskCheckboxPlugin 同构($prose 工厂)。
 *
 * 作用:在 ProseMirror 的 handlePaste / handleDrop 中检测图片,命中则拦截默认行为,
 *   把图片 Blob + 目标位置 emit 到 window 事件 soulmark:image-insert,
 *   由 React 侧(Editor 组件)监听后调 saveImageAsset 落盘 + insertImageCommand 插入引用。
 *
 * 为何不在插件内直接落盘:
 *  1. useEditor 的 get 回调只跑一次,插件闭包拿不到动态的 filePath(切 tab 变化);
 *     走事件桥接可复用 Editor 组件的 filePathRef(与 shiki-theme 事件桥接同款范式)。
 *  2. 落盘是异步重操作(ensureDir/writeBinaryFile),放 React 侧便于统一错误提示(message 弹窗)。
 *  3. 插入图片节点用 insertImageCommand(自带 scrollIntoView),需 editor.action + ctx,
 *     在 React 侧调用更顺手(与 SelectionToolbar 的命令调用范式一致)。
 *
 * 拦截规则:返回 true 拦截默认行为(防插入乱码/防浏览器打开图片);无图片返回 false 放行。
 * 必须 preventDefault:drop 时浏览器默认会用自己打开图片(离开编辑器),paste 默认可能插入文件名文本。 */

export const imageDropKey = new PluginKey("imageDrop");

/** 事件负载:图片 Blob + 目标 doc 位置(ProseMirror pos)。 */
export interface ImageInsertPayload {
  blob: Blob;
  pos: number;
}

/** 检查 DataTransfer 是否含图片项,返回第一个匹配的 File(Blob 子类)。 */
function pickImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  // 优先 items(可区分 kind:file + type:image/*)
  if (data.items && data.items.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
  }
  // 回退 files(部分 webview items 不可用时)
  if (data.files && data.files.length) {
    for (const f of Array.from(data.files)) {
      if (f.type.startsWith("image/")) return f;
    }
  }
  return null;
}

/** 派发图片插入事件,供 Editor 组件监听。 */
function emitInsert(blob: Blob, pos: number): void {
  window.dispatchEvent(
    new CustomEvent<ImageInsertPayload>("soulmark:image-insert", {
      detail: { blob, pos },
    }),
  );
}

export const imageDropPlugin = $prose(
  () =>
    new Plugin({
      key: imageDropKey,
      props: {
        handlePaste(view, event: ClipboardEvent) {
          const file = pickImageFile(event.clipboardData);
          if (!file) return false; // 非图片:放行默认文本粘贴
          event.preventDefault();
          emitInsert(file, view.state.selection.from);
          return true; // 拦截:防插入文件名文本乱码
        },
        handleDrop(view, event: DragEvent) {
          const file = pickImageFile(event.dataTransfer);
          if (!file) return false; // 非图片(如文本拖拽):放行
          event.preventDefault();
          // 落点位置:用鼠标坐标算 doc pos;失败回退到当前选区头
          const coords = { left: event.clientX, top: event.clientY };
          const result = view.posAtCoords(coords);
          const pos = result?.pos ?? view.state.selection.from;
          emitInsert(file, pos);
          return true; // 拦截:防浏览器打开图片
        },
      },
    }),
);

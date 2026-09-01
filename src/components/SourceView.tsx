import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { EditorHandle } from "./Editor";

/* 源码模式视图:用 textarea 承载 Markdown 原文,替代 Milkdown WYSIWYG。
   纯文本无高亮(等宽字体),可编辑。

   数据流:
   - mount / 切 tab(activeTabId 变化):从 Milkdown getMarkdown() 读当前内容填入 textarea。
     切 tab 时 useFile.flushCurrentTab 已先 flushSource 把源码写回 Milkdown、
     再 setMarkdown 加载目标 tab,故此处 getMarkdown 读到的是目标 tab 内容,不丢数据。
   - 编辑:onChange 更新本地 text/textRef + 调 onMdChange 置 tab dirty
     (不实时写回 Milkdown:setMarkdown 走 updateState 重建 + 末尾 focus()
      会抢 textarea 焦点,无法连续打字)
   - 退出源码模式(sourceMode→false 卸载):unmount cleanup 调 setMarkdown 写回 Milkdown
   - 切 tab/保存/另存:由 useFile 的 flushSource 在 getMarkdown 前先调 flush() 同步

   滚动同步:正常模式滚 .editor-wrap,源码模式滚 textarea,两者像素高度差异大
   (渲染 HTML vs 等宽纯文本),无法像素级对齐。改按"滚动比例"同步:进入时把
   wrap 的 scrollTop/scrollHeight 比例映射到 textarea;退出时反向映射回 wrap。
   保证切换后大致停留在同一内容区域。

   textRef 与 state 并存:cleanup 里读 state 是闭包陈旧值,ref 始终最新。
   切 tab 不卸载本组件(渲染条件仍 true),故 cleanup 不会在切 tab 时误写
   (否则会把旧 tab 源码覆盖到已加载新 tab 的 Milkdown)。 */

export interface SourceViewHandle {
  /** 把 textarea 当前内容同步写回 Milkdown(切 tab/保存前由 useFile 调用) */
  flush: () => void;
}

interface SourceViewProps {
  editorRef: React.RefObject<EditorHandle | null>;
  /** 当前激活 tab id:变化时重新从 Milkdown 读取内容(切 tab 场景) */
  activeTabId: number | null;
  /** 内容变化回调:复用 useFile.onMdChange 置当前 tab dirty */
  onMdChange: () => void;
  /** 正常模式的滚动容器(.editor-wrap):退出源码时按比例恢复其滚动位置 */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** 进入源码前捕获的 wrap 滚动比例(0~1),mount 时按比例设 textarea.scrollTop。
   *  为何不从 wrap 读:CSS 隐藏 Milkdown 后 wrap.scrollHeight 塌缩,useEffect 读到 0。
   *  改由 App.toggleSourceMode 在切换前同步捕获,经此 prop 传入。 */
  initialScrollRatio: React.MutableRefObject<number>;
}

export const SourceView = forwardRef<SourceViewHandle, SourceViewProps>(
  function SourceView({ editorRef, activeTabId, onMdChange, scrollContainerRef, initialScrollRatio }, ref) {
    const [text, setText] = useState("");
    const textRef = useRef("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // textarea 最新滚动比例(0~1),onScroll 持续更新;unmount cleanup 读它,
    // 避免依赖 DOM 时序(textarea 卸载时 ref 可能已被 React 置空)
    const scrollRatioRef = useRef(0);

    // mount + 切 tab:从 Milkdown 读当前 md + 按比例设 textarea 滚动
    useEffect(() => {
      const md = editorRef.current?.getMarkdown() ?? "";
      setText(md);
      textRef.current = md;
      // 双 rAF:① 等 textarea 内容渲染落地才能算 scrollHeight;
      //        ② 切 tab 时躲开 useFile.restoreScrollTop(它也用双 rAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          const ratio = initialScrollRatio.current;
          const taMax = ta.scrollHeight - ta.clientHeight;
          ta.scrollTop = Math.max(0, Math.min(ratio * taMax, taMax));
          scrollRatioRef.current = ratio;
        });
      });
    }, [activeTabId, editorRef, initialScrollRatio]);

    // 暴露 flush:写回 Milkdown(setMarkdown 不触发 listener,不重复置 dirty)
    useImperativeHandle(
      ref,
      () => ({
        flush: () => {
          editorRef.current?.setMarkdown(textRef.current);
        },
      }),
      [editorRef],
    );

    // unmount 兜底:退出源码模式(组件卸载)时把最新内容写回 Milkdown
    // + 按比例恢复 .editor-wrap 滚动位置。仅在卸载时执行:切 tab 不卸载本组件,不会误写。
    useEffect(() => {
      return () => {
        const ratio = scrollRatioRef.current;
        const wrap = scrollContainerRef.current;
        editorRef.current?.setMarkdown(textRef.current);
        // setMarkdown 同步重建 Milkdown,高度变化需双 rAF 后再设 scrollTop
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!wrap) return;
            const max = wrap.scrollHeight - wrap.clientHeight;
            wrap.scrollTop = Math.max(0, Math.min(ratio * max, max));
          });
        });
      };
    }, [editorRef, scrollContainerRef]);

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setText(v);
      textRef.current = v;
      onMdChange();
    };

    // 持续记录滚动比例,供 unmount cleanup 恢复
    const onScroll = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const max = ta.scrollHeight - ta.clientHeight;
      scrollRatioRef.current = max > 0 ? ta.scrollTop / max : 0;
    };

    return (
      <textarea
        ref={textareaRef}
        className="source-view"
        value={text}
        onChange={onChange}
        onScroll={onScroll}
        spellCheck={false}
        autoFocus
      />
    );
  },
);

export default SourceView;

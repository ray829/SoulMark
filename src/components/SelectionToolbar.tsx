import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor, CmdKey } from "@milkdown/kit/core";
import { commandsCtx, editorViewCtx, schemaCtx } from "@milkdown/kit/core";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  updateLinkCommand,
  wrapInHeadingCommand,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { toggleHighlightCommand } from "./editor-views/MarkView";

/* 选区浮动工具栏(类 Notion 网页端):选中文本时在选区上方浮出横栏,
 * 可切换 mark(加粗/斜体/删除线/高亮/行内代码)、套用标题级别、转块(正文/引用/代码块)、
 * 插入/编辑链接。
 *
 * 与编辑器的衔接复用项目已有范式:
 *  - 事件桥接:SelectionTrackerPlugin 在 view.update / blur 时派发
 *    soulmark:selection-change,本组件订阅(与 shiki-theme 事件桥接同构)。
 *  - 命令调用:editor.action((ctx) => ctx.get(commandsCtx).call(KEY, payload)),
 *    与 EditorHandle 内 undo/redo 同款。
 *  - 浮层范式:createPortal 到 body + fixed 定位 + Escape/外部交互关闭
 *    (与 ContextMenu / PromptDialog 同构)。
 *
 * 关键交互:按钮一律 onMouseDown preventDefault,既防止点击导致编辑器失焦(选区折叠),
 * 也防止 blur 事件误触发工具栏隐藏。链接输入框打开期间锁定隐藏逻辑。
 */

interface Rect {
  left: number;
  top: number;
  /** true=显示在选区下方(上方空间不足时翻转) */
  flip: boolean;
}

interface SelectionToolbarProps {
  /** Milkdown 编辑器实例 getter(来自 useEditor 的 get)。 */
  getEditor: () => Editor | undefined;
}

/** mark 名 → 是否激活。块级(标题/正文)不在此列,块级 active 态不显示(避免歧义)。 */
type ActiveMap = Record<string, boolean>;

const BAR_HEIGHT = 36;

export function SelectionToolbar({ getEditor }: SelectionToolbarProps) {
  const [pos, setPos] = useState<Rect | null>(null);
  const [active, setActive] = useState<ActiveMap>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkVal, setLinkVal] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  /** 标题级别下拉是否展开 + 下拉面板 ref(用于判断外部点击关闭)。 */
  const [headingOpen, setHeadingOpen] = useState(false);
  const headingPanelRef = useRef<HTMLDivElement>(null);
  /** 当前选区是否禁止转标题(跨块 / 表格内 / 列表内):禁用标题下拉触发器。 */
  const [headingDisabled, setHeadingDisabled] = useState(false);

  /** 工具栏当前位置(null=隐藏)。posRef 同步镜像,供 refresh 闭包准确判断可见性。
   *  不能用 useEffect 同步 pos→ref:effect 在 commit 后才跑,滞后一拍会导致
   *  首次选区变化误判为「已可见」走立即分支,工具栏闪现在拖选中途的瞬时坐标。 */
  const posRef = useRef<Rect | null>(null);
  /** 首次显示的延迟 timer:选中后 debounce 0.5s 再弹出,拖选过程不闪烁。 */
  const showTimerRef = useRef<number | null>(null);
  /** 鼠标是否在编辑器内按住(拖选中)。拖选期间不显示/不计时,松手后才开始 0.5s 计时。
   *  这避免「拖选超过 0.5s / 中途停顿 0.5s」时 timer 在中途触发,工具栏先显示在中间位置、
   *  松手后又跳到最终位置(用户感知为「先左后右跳变」)。 */
  const selectingRef = useRef(false);
  /** 统一的 pos setter:同步更新 posRef(避免闭包陈旧),隐藏时一并重置浮层子状态
   *  (标题下拉 / 链接输入),防止下次显示时残留弹出。 */
  const setPosSafe = useCallback((p: Rect | null) => {
    posRef.current = p;
    setPos(p);
    if (p === null) {
      setHeadingOpen(false);
      setLinkOpen(false);
      setLinkVal("");
    }
  }, []);
  useEffect(() => {
    // 卸载时清掉 pending 显示 timer,避免卸载后 setState
    return () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };
  }, []);

  /** 立即算坐标并显示(已确认选区有效时调用)。延迟到期 / 已可见时走此路径。 */
  const showNow = useCallback(() => {
    const editor = getEditor();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const cur = view.state.selection;
      // 到时再确认一次:可能期间已失焦、选区折叠,或选区已变成纯空白
      const blank = view.state.doc.textBetween(cur.from, cur.to, " ").trim() === "";
      if (cur.empty || blank || !view.hasFocus()) {
        setPosSafe(null);
        return;
      }
      const a = view.coordsAtPos(cur.from);
      const b = view.coordsAtPos(cur.to);
      const topMin = Math.min(a.top, b.top);
      const bottomMax = Math.max(a.bottom, b.bottom);
      const leftMid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2;
      let top = topMin - 6 - BAR_HEIGHT;
      let flip = false;
      if (top < 8) top = bottomMax + 6; // 上方空间不足:翻转到选区下方
      const left = Math.max(8, Math.min(leftMid, window.innerWidth - 8));
      setPosSafe({ left, top, flip });
    });
  }, [getEditor, setPosSafe]);

  /** 清除 pending 显示 timer。选区失效 / 已显示时调用。 */
  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  /** 读取当前 selection,刷新浮层位置与 active 态。
   *  从事件(scroll/selection-change)与命令执行后两条路径调用,均直接读 view 最新状态。
   *  显示时机:首次从隐藏→显示 debounce 0.5s(拖选过程不断重置,松手 0.5s 后弹出);
   *  已显示后的状态刷新立即(点按钮 / 滚动 / 微调选区不延迟)。 */
  const refresh = useCallback(() => {
    // 链接输入 / 标题下拉打开期间锁定:不因 blur / 选区变化 / 滚动而隐藏或移位,
    // 保留浮层稳定(否则点开下拉后工具栏整体重定位,下拉面板跟着左右跳)。
    if (linkOpen || headingOpen) return;
    // 鼠标按住拖选中:不显示/不计时,松手后由 mouseup 触发显示。
    // 阻断拖选中途 timer 误触发 → 中途显示 → 松手跳到最终位置的跳变。
    if (selectingRef.current) {
      clearShowTimer();
      setPosSafe(null);
      return;
    }
    const editor = getEditor();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { empty, $from, $to, from, to } = view.state.selection;
      // 选区在代码块内不显示(代码块内无行内 mark 语义)
      const inCodeBlock = $from.parent.type.name === "code_block";
      // 纯空白选区不显示:选区仅含空行/空格、无实际文字(如拖选跨越连续空段落)。
      // 对纯空白加粗/设标题等无意义,且会在空段落上留下不可见 mark,后续输入才显现,
      // 易造成「没操作却变粗」的困惑。textBetween 用空格替换块边界,trim 后判空。
      const blank = view.state.doc.textBetween(from, to, " ").trim() === "";
      if (empty || inCodeBlock || blank || !view.hasFocus()) {
        clearShowTimer();
        setPosSafe(null);
        setActive({});
        setHeadingDisabled(false);
        return;
      }
      // active marks:取选区起点 marks(commonmark 对选区统一 mark,起点足够)
      const marks = $from.marks();
      // 列表 active / 是否在列表内:遍历 $from 祖先链
      let inUl = false;
      let inOl = false;
      let inTable = false;
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === "bullet_list") inUl = true;
        else if (name === "ordered_list") inOl = true;
        else if (name === "table") inTable = true;
      }
      // 标题禁用条件:setBlockType 只作用于单块。
      //  - 跨块选区($from/$to 不同一父块):只转首块不符预期,禁用;
      //  - 表格内:转标题会破坏单元格结构,禁用;
      //  - 列表内:list_item 不允许直接含 heading,禁用(需先取消列表)。
      const headingDisabledNow = inTable || inUl || inOl || !$from.sameParent($to);
      setActive({
        bold: marks.some((m) => m.type.name === "strong"),
        italic: marks.some((m) => m.type.name === "emphasis"),
        strike: marks.some((m) => m.type.name === "strike_through"),
        highlight: marks.some((m) => m.type.name === "highlight"),
        code: marks.some((m) => m.type.name === "inline_code"),
        // 块级 active:标题(不分级别统一高亮)、列表
        heading: $from.parent.type.name === "heading",
        ul: inUl,
        ol: inOl,
      });
      setHeadingDisabled(headingDisabledNow);
      // 显示策略(posRef 同步准确):已可见 → 立即更新坐标;隐藏中 → debounce 1s 后显示。
      if (posRef.current !== null) {
        requestAnimationFrame(() => showNow());
      } else {
        clearShowTimer();
        showTimerRef.current = window.setTimeout(() => {
          showTimerRef.current = null;
          showNow();
        }, 500);
      }
    });
  }, [getEditor, linkOpen, headingOpen, clearShowTimer, showNow, setPosSafe]);

  useEffect(() => {
    const onSel = () => refresh();
    window.addEventListener("soulmark:selection-change", onSel);
    // 滚动(含编辑器内部滚动,capture 捕获)+ 窗口缩放:重算坐标
    window.addEventListener("scroll", onSel, true);
    window.addEventListener("resize", onSel);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 优先级:链接输入 > 标题下拉 > 整体隐藏
        if (linkOpen) {
          setLinkOpen(false);
        } else if (headingOpen) {
          setHeadingOpen(false);
        } else {
          setPosSafe(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("soulmark:selection-change", onSel);
      window.removeEventListener("scroll", onSel, true);
      window.removeEventListener("resize", onSel);
      window.removeEventListener("keydown", onKey);
    };
  }, [refresh, linkOpen, headingOpen, setPosSafe]);

  /** 拖选状态跟踪:鼠标在编辑器内按住 → selecting=true(隐藏工具栏+不计时);
   *  松手 → selecting=false + refresh 启动 1s 显示计时。
   *  用 capture 阶段,确保在编辑器自身处理之前记录状态。 */
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const editor = getEditor();
      if (!editor) return;
      let inEditor = false;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        inEditor = view.dom.contains(e.target as Node);
      });
      if (!inEditor) return;
      selectingRef.current = true;
      // 开始新一次拖选:清掉旧工具栏与 pending 计时,避免中途误显示
      clearShowTimer();
      setPosSafe(null);
    };
    const onMouseUp = () => {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      // 松手:启动 1s 显示流程(refresh 内 posRef===null → debounce)
      refresh();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [getEditor, clearShowTimer, setPosSafe, refresh]);

  /** 执行一条 Milkdown 命令(无参 mark toggle)。preventDefault 防失焦,执行后刷新 active。 */
  const run = useCallback(
    (key: CmdKey<unknown>) => (e: React.MouseEvent) => {
      e.preventDefault();
      const editor = getEditor();
      if (!editor) return;
      editor.action((ctx) => {
        ctx.get(commandsCtx).call(key);
      });
      // toggleMark 不改 from/to,selection-change 不会派发,需手动刷新 active
      refresh();
    },
    [getEditor, refresh],
  );

  /** 套用块级:heading 用 wrapInHeadingCommand(level);paragraph/code_block 用
   *  setBlockTypeCommand;blockquote/list 用 wrapInBlockTypeCommand。 */
  const runBlock = useCallback(
    (kind: "heading" | "set" | "wrap", name: string, level?: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const editor = getEditor();
      if (!editor) return;
      editor.action((ctx) => {
        const schema = ctx.get(schemaCtx);
        const commands = ctx.get(commandsCtx);
        if (kind === "heading" && level != null) {
          commands.call(wrapInHeadingCommand.key, level);
          return;
        }
        const nodeType = schema.nodes[name];
        if (!nodeType) return;
        if (kind === "set") commands.call(setBlockTypeCommand.key, { nodeType });
        else commands.call(wrapInBlockTypeCommand.key, { nodeType });
      });
      refresh();
    },
    [getEditor, refresh],
  );

  /** 打开链接输入框:预填当前选区已存在的链接 href(若有)。 */
  const openLink = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const editor = getEditor();
      if (!editor) return;
      let existing = "";
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const marks = view.state.selection.$from.marks();
        const link = marks.find((m) => m.type.name === "link");
        existing = (link?.attrs.href as string) ?? "";
      });
      setLinkVal(existing);
      setLinkOpen(true);
      // autoFocus:下一帧聚焦(此时 input 已挂载)
      requestAnimationFrame(() => linkInputRef.current?.focus());
    },
    [getEditor],
  );

  /** 确认链接:调 updateLinkCommand({href})。空 href 则移除链接(href 传 undefined)。 */
  const confirmLink = useCallback(() => {
    const href = linkVal.trim();
    const editor = getEditor();
    if (!editor) {
      setLinkOpen(false);
      return;
    }
    editor.action((ctx) => {
      ctx.get(commandsCtx).call(updateLinkCommand.key, { href: href || undefined });
      ctx.get(editorViewCtx).focus();
    });
    setLinkOpen(false);
    setLinkVal("");
    // 恢复焦点后刷新工具栏(选区仍在,重新定位 + active)
    refresh();
  }, [getEditor, linkVal, refresh]);

  if (!pos) return null;

  return createPortal(
    <div
      className="md-selection-toolbar"
      style={{ left: pos.left, top: pos.top }}
      data-flip={pos.flip || undefined}
      // 整条工具栏不抢编辑器焦点:mousedown 阻止默认焦点转移
      onMouseDown={(e) => {
        if (linkOpen) return; // 链接输入框内部需要正常获取焦点
        // 标题下拉展开时:点击非触发器、非下拉面板处(如其它按钮)先收起下拉,
        // 再让对应按钮的 onMouseDown 正常执行(事件冒泡未阻断)。
        if (headingOpen) {
          const t = e.target as HTMLElement;
          if (
            !t.closest("[data-heading-trigger]") &&
            !headingPanelRef.current?.contains(t)
          ) {
            setHeadingOpen(false);
          }
        }
        // 整条工具栏不抢编辑器焦点:mousedown 阻止默认焦点转移
        e.preventDefault();
      }}
      role="toolbar"
      aria-label="文本格式"
    >
      {linkOpen ? (
        <div className="md-toolbar-link" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={linkInputRef}
            className="md-toolbar-link-input"
            value={linkVal}
            placeholder="链接地址 https://"
            onChange={(e) => setLinkVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLinkOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="md-toolbar-btn primary"
            onMouseDown={(e) => {
              e.preventDefault();
              confirmLink();
            }}
          >
            确定
          </button>
        </div>
      ) : (
        <>
          {/* mark 组 */}
          <button type="button" className="md-toolbar-btn" data-active={active.bold || undefined} onMouseDown={run(toggleStrongCommand.key)} title="加粗 ⌘B">B</button>
          <button type="button" className="md-toolbar-btn italic" data-active={active.italic || undefined} onMouseDown={run(toggleEmphasisCommand.key)} title="斜体 ⌘I">I</button>
          <button type="button" className="md-toolbar-btn strike" data-active={active.strike || undefined} onMouseDown={run(toggleStrikethroughCommand.key)} title="删除线">S</button>
          <button type="button" className="md-toolbar-btn" data-active={active.highlight || undefined} onMouseDown={run(toggleHighlightCommand.key)} title="高亮 ==">H</button>
          <button type="button" className="md-toolbar-btn code" data-active={active.code || undefined} onMouseDown={run(toggleInlineCodeCommand.key)} title="行内代码">{"</>"}</button>
          <span className="md-toolbar-sep" />
          <button type="button" className="md-toolbar-btn" onMouseDown={openLink} title="链接">🔗</button>
          <span className="md-toolbar-sep" />
          {/* 标题级别:收进下拉面板。跨块/表格内/列表内禁用(setBlockType 只作用于单块) */}
          <div className="md-toolbar-dropdown">
            <button
              type="button"
              className="md-toolbar-btn heading"
              data-heading-trigger
              data-active={active.heading || undefined}
              data-disabled={headingDisabled || undefined}
              disabled={headingDisabled}
              title={headingDisabled ? "当前选区不支持转为标题" : "标题"}
              onMouseDown={(e) => {
                e.preventDefault();
                if (headingDisabled) return; // 禁用时不展开
                setHeadingOpen((v) => !v);
              }}
            >
              标题<span className="md-toolbar-caret">▾</span>
            </button>
            {headingOpen && (
              <div
                className="md-toolbar-menu"
                ref={headingPanelRef}
                onMouseDown={(e) => e.preventDefault()}
              >
                {[1, 2, 3, 4, 5, 6].map((l) => (
                  <button
                    key={l}
                    type="button"
                    className="md-toolbar-menu-btn"
                    title={`标题 ${l}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setHeadingOpen(false);
                      const editor = getEditor();
                      if (!editor) return;
                      editor.action((ctx) => {
                        ctx.get(commandsCtx).call(wrapInHeadingCommand.key, l);
                      });
                      refresh();
                    }}
                  >
                    <span className={`md-h md-h${l}`}>标题 {l}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="md-toolbar-sep" />
          {/* 列表 */}
          <button type="button" className="md-toolbar-btn" data-active={active.ul || undefined} onMouseDown={runBlock("wrap", "bullet_list")} title="无序列表">☰</button>
          <button type="button" className="md-toolbar-btn list-ol" data-active={active.ol || undefined} onMouseDown={runBlock("wrap", "ordered_list")} title="有序列表">1.</button>
          <span className="md-toolbar-sep" />
          {/* 块级 */}
          <button type="button" className="md-toolbar-btn" onMouseDown={runBlock("set", "paragraph")} title="正文">¶</button>
          <button type="button" className="md-toolbar-btn" onMouseDown={runBlock("wrap", "blockquote")} title="引用">❝</button>
          <button type="button" className="md-toolbar-btn code" onMouseDown={runBlock("set", "code_block")} title="代码块">{"{ }"}</button>
        </>
      )}
    </div>,
    document.body,
  );
}

export default SelectionToolbar;

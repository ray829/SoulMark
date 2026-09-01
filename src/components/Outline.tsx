import { useCallback, useEffect, useRef } from "react";
import { useOutline, type OutlineHeading } from "../hooks/useOutline";

interface OutlineProps {
  scrollRef: React.RefObject<HTMLElement | null>;
}

export function Outline({ scrollRef }: OutlineProps) {
  const { headings, activeId, padBottom, scrollToHeading } = useOutline(scrollRef);
  const hasHeadings = headings.length > 0;
  /** 浮层(文字列表)滚动容器:active 跟随时滚浮层 */
  const floatRef = useRef<HTMLDivElement>(null);
  /** 刻度尺滚动容器:标题多时刻度尺超顶可滚,active 跟随把目标刻度滚入视野 */
  const rulerRef = useRef<HTMLDivElement>(null);
  /** 当前 active 浮层项的 DOM 引用:用于把 active 项带入浮层可视区 */
  const activeRef = useRef<HTMLDivElement>(null);
  /** 当前 active 刻度行的 DOM 引用:用于把 active 刻度带入刻度尺可视区 */
  const activeTickRef = useRef<HTMLDivElement>(null);

  // 把底部补白写入滚动容器:让最末标题也能滚到顶部(参考 Notion)。
  // hasHeadings=false 时清零(避免上一文档残留)。大纲为悬浮(fixed),不占布局宽度。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.style.setProperty("--outline-pad-bottom", hasHeadings ? `${padBottom}px` : "0px");
  }, [hasHeadings, padBottom, scrollRef]);

  /** 把指定项带入指定滚动容器的可视区(nearest 语义:已在视野内不动,避免抖)。
   *  瞬时无动画,刻度尺与浮层各自跟随、互不惊动。 */
  const ensureVisible = useCallback(
    (container: HTMLElement | null, item: HTMLElement | null) => {
      if (!container || !item) return;
      const ir = item.getBoundingClientRect();
      const pr = container.getBoundingClientRect();
      const margin = 4;
      if (ir.top < pr.top + margin) {
        container.scrollTop -= pr.top + margin - ir.top;
      } else if (ir.bottom > pr.bottom - margin) {
        container.scrollTop += ir.bottom - (pr.bottom - margin);
      }
    },
    [],
  );
  const ensureFloatVisible = useCallback(
    () => ensureVisible(floatRef.current, activeRef.current),
    [ensureVisible],
  );
  const ensureRulerVisible = useCallback(
    () => ensureVisible(rulerRef.current, activeTickRef.current),
    [ensureVisible],
  );

  // active 跟随:activeId 变化(正文滚动 / 点击跳转)时,若 active 项滑出可视区,
  // 把它滚回。浮层与刻度尺各自跟随(刻度尺仅内容超顶可滚时才需要)。
  useEffect(() => {
    ensureFloatVisible();
    ensureRulerVisible();
  }, [activeId, ensureFloatVisible, ensureRulerVisible]);

  if (!hasHeadings) return null;

  return (
    <div
      className="outline-root"
      // 进入 root(浮层打开)时主动把 active 项带入视野一次:折叠态浮层不可见,
      // active 项可能在可视区外,展开后拉回;瞬时无动画,避免缓动抖动。
      onMouseEnter={ensureFloatVisible}
    >
      {/* 刻度尺常驻层:几何恒定(无 hover 过渡),行高由 flex 均分、不随交互变化。
          标题多时超顶可滚,active 仅改色不改布局 → 切换 active / hover 全程零位移。 */}
      <div className="outline-ruler" ref={rulerRef}>
        {headings.map((h) => (
          <div
            key={h.id}
            className="outline-tick-row"
            data-level={h.level}
            data-active={h.id === activeId}
            ref={h.id === activeId ? activeTickRef : undefined}
            onClick={() => scrollToHeading(h.el, h.id)}
            aria-label={h.text}
            title={h.text}
          >
            <span className="outline-tick" />
          </div>
        ))}
      </div>
      {/* hover 浮层:流内子元素,紧贴刻度尺左缘(相邻无间隙,防 mouseleave),
          高度由自身内容撑起从而决定 root 高度(标题少不滚动,顶破 60% 封顶才滚),
          默认隐藏、fade-in 显示文字列表。
          item 高度固定、可滚,active 高亮整行 + 左 marker,文字超长原位横滚。 */}
      <div className="outline-float" ref={floatRef}>
        {headings.map((h) => (
          <OutlineItem
            key={h.id}
            heading={h}
            active={h.id === activeId}
            activeRef={h.id === activeId ? activeRef : undefined}
            onJump={() => scrollToHeading(h.el, h.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface OutlineItemProps {
  heading: OutlineHeading;
  active: boolean;
  /** 仅 active 项接收 ref,供跟随滚动定位 */
  activeRef?: React.RefObject<HTMLDivElement | null>;
  onJump: () => void;
}

function OutlineItem({ heading, active, activeRef, onJump }: OutlineItemProps) {
  // 层级缩进:每级 +12px(H1 顶格),展开态文字层级缩进
  const indent = (heading.level - 1) * 12;
  const innerRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  /** hover 时让标题文字在原位横向滚动显示全文。
   *  .outline-text 固定宽度容器(overflow:hidden),内层文字 max-width 不限。
   *  hover 时若文字溢出容器,启动 CSS transition 从左滚到右端露出全文,鼠标离开复位。
   *  滚动发生在 .outline-text 内部,不溢出浮层,任意长度都能滚到完整显示。 */
  const handleEnter = () => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    if (inner.scrollWidth <= wrap.clientWidth + 1) return;
    const distance = inner.scrollWidth - wrap.clientWidth;
    inner.style.setProperty("--outline-scroll-distance", `-${distance}px`);
    inner.classList.add("scrolling");
  };
  const handleLeave = () => {
    const inner = innerRef.current;
    if (!inner) return;
    inner.classList.remove("scrolling");
    inner.style.transform = "";
  };

  return (
    <div
      ref={activeRef ?? undefined}
      className={`outline-item${active ? " active" : ""}`}
      onClick={onJump}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ paddingLeft: `${indent + 8}px` }}
    >
      <span className="outline-marker" aria-hidden="true" />
      <span className="outline-text" ref={wrapRef}>
        <span className="outline-text-inner" ref={innerRef}>{heading.text}</span>
      </span>
    </div>
  );
}

export default Outline;

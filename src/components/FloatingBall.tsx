import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowUpIcon,
  FocusIcon,
  PanelLeftIcon,
  SettingsIcon,
  TypeIcon,
} from "./icons";

/* 悬浮球工具按钮:定位在主内容区右下角。
   - 主球:齿轮图标(hover 旋转 60°,按住持续旋转),hover/点击展开菜单
   - 垂直弹出:子按钮沿纵向向上贝塞尔弹出,从下到上错峰
   - 纯图标按钮:hover 延迟后显示文字 tooltip
   - 回到顶部:独立按钮,常驻主球上方,滚动超阈值时贝塞尔弹出
   - Hover 优先:hover/click 均可展开,Esc/点外部收起 */

interface FloatingBallProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onScrollToTop: () => void;
  fontSize: number;
  onCycleFontSize: () => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

/** 滚动多少 px 后显示"回到顶部"按钮 */
const SCROLL_THRESHOLD = 300;
/** hover 展开防误触延迟 */
const OPEN_DELAY = 120;
/** 子按钮 hover 多久后显示文字 tooltip */
const TIP_DELAY = 900;
/** 回到顶部按钮距主球圆心的纵向偏移(px) */
const TOP_TY = 50;
/** 菜单子项逐项间距(px) */
const ITEM_GAP = 48;
/** 回到顶部按钮显示时,菜单第一项距主球圆心(给按钮留位) */
const ITEM_START_WITH_TOP = 100;
/** 回到顶部按钮隐藏时,菜单第一项紧贴主球,不留空隙 */
const ITEM_START_NO_TOP = 56;

interface ItemDef {
  key: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/** 单个子项:纯圆形图标按钮 + hover 延迟文字 tooltip。 */
function FabItem({
  item,
  ty,
  onHoverIn,
  onHoverOut,
}: {
  item: ItemDef;
  /** 展开目标 y 偏移(相对主球圆心,负值向上),通过 CSS 变量驱动动画 */
  ty: number;
  onHoverIn: () => void;
  onHoverOut: () => void;
}) {
  const [tip, setTip] = useState(false);
  const tipTimer = useRef<number | null>(null);

  const onEnter = () => {
    onHoverIn();
    if (tipTimer.current) window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(true), TIP_DELAY);
  };
  const onLeave = () => {
    onHoverOut();
    if (tipTimer.current) {
      window.clearTimeout(tipTimer.current);
      tipTimer.current = null;
    }
    setTip(false);
  };
  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (tipTimer.current) window.clearTimeout(tipTimer.current);
    };
  }, []);

  return (
    <button
      type="button"
      className="fab-item"
      role="menuitem"
      aria-label={item.label}
      style={{ "--ty": `${ty}px` } as CSSProperties}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={() => {
        item.onClick();
        setTip(false);
      }}
    >
      {item.icon}
      <span className="fab-tip" data-show={tip}>
        {item.label}
      </span>
    </button>
  );
}

export function FloatingBall(props: FloatingBallProps) {
  const {
    scrollContainerRef,
    onScrollToTop,
    fontSize,
    onCycleFontSize,
    focusMode,
    onToggleFocusMode,
    sidebarCollapsed,
    onToggleSidebar,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const openTimer = useRef<number | null>(null);

  // 监听滚动容器,超过阈值显示"回到顶部"按钮(rAF 节流)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setIsScrolled(el.scrollTop >= SCROLL_THRESHOLD);
        ticking = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef]);

  // Esc 收起 + 点外部收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDocClick = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open]);

  // 清理 hover 定时器
  useEffect(() => {
    return () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
    };
  }, []);

  const openMenu = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const closeMenu = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(false), OPEN_DELAY);
  };
  const toggleMenu = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    setOpen((v) => !v);
  };

  // 主球键盘:Enter/Space 触发与点击一致的行为(展开/收起菜单)
  const onMainKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleMenu();
    }
  };

  // 当前字号标签
  const fontLabel = `${fontSize}px`;

  // 菜单第一项起始位置:回到顶部按钮显示时上移让位,否则紧贴主球
  // (避免未滚动时主球与菜单间空出"回到顶部"的预留间隔)
  const itemStart = isScrolled ? ITEM_START_WITH_TOP : ITEM_START_NO_TOP;

  // 子项按从下到上顺序排布(靠近主球的先弹出)
  const items: ItemDef[] = [
    {
      key: "focus",
      icon: <FocusIcon />,
      label: focusMode ? "退出专注模式" : "进入专注模式",
      onClick: onToggleFocusMode,
    },
    {
      key: "font",
      icon: <TypeIcon />,
      label: `字号 ${fontLabel}`,
      onClick: onCycleFontSize,
    },
    {
      key: "sidebar",
      icon: <PanelLeftIcon className={sidebarCollapsed ? "flipped" : ""} />,
      label: sidebarCollapsed ? "展开侧边栏" : "收起侧边栏",
      onClick: onToggleSidebar,
    },
  ];

  // hover 桥接高度:覆盖主球顶部到最远菜单项,消除鼠标移动间隙
  const bridgeHeight = itemStart + (items.length - 1) * ITEM_GAP + 20;

  return (
    <div ref={rootRef} className="fab" data-open={open}>
      {/* 子菜单:0 尺寸坐标原点对齐主球圆心,按钮 absolute 定位到纵向坐标。
          始终渲染(不条件),使收起时也有归位动画。 */}
      <div className="fab-menu" role="menu">
        {items.map((item, i) => (
          <FabItem
            key={item.key}
            item={item}
            ty={-(itemStart + i * ITEM_GAP)}
            onHoverIn={openMenu}
            onHoverOut={closeMenu}
          />
        ))}
      </div>

      {/* hover 桥接:展开时填充主球与菜单项间的空白,
          鼠标从主球移向菜单项时不会因穿越间隙而触发关闭 */}
      <div
        className="fab-bridge"
        style={{ "--bridge-h": `${bridgeHeight}px` } as CSSProperties}
        onMouseEnter={openMenu}
        onMouseLeave={closeMenu}
      />

      {/* 回到顶部:独立按钮,常驻主球上方,滚动超阈值时贝塞尔弹出。
          不参与菜单展开,始终渲染以保留弹出/收回动画。 */}
      <button
        type="button"
        className="fab-top"
        data-show={isScrolled}
        style={{ "--top-ty": `${-TOP_TY}px` } as CSSProperties}
        aria-label="回到顶部"
        aria-hidden={!isScrolled}
        tabIndex={isScrolled ? 0 : -1}
        onClick={() => {
          onScrollToTop();
          setOpen(false);
        }}
      >
        <ArrowUpIcon />
        <span className="fab-tip">回到顶部</span>
      </button>

      <button
        type="button"
        className="fab-main"
        data-open={open}
        aria-label="工具菜单"
        aria-expanded={open}
        aria-haspopup="menu"
        onMouseEnter={openMenu}
        onMouseLeave={closeMenu}
        onClick={toggleMenu}
        onKeyDown={onMainKeyDown}
      >
        {/* 齿轮:参考设置按钮交互——hover 旋转 60°,按住持续旋转 */}
        <span className="fab-main-icon">
          <SettingsIcon />
        </span>
      </button>
    </div>
  );
}

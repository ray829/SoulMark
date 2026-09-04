/** 平滑滚动工具:用 rAF + 缓动函数替代原生 `behavior: "smooth"`。
 *
 *  原因:Tauri 桌面端 WKWebView / WebView2 对 div 级 `overflow: auto` 元素的
 *  `scrollIntoView({ behavior: "smooth" })` 与 `scrollTo({ behavior: "smooth" })` 支持
 *  不可靠(WKWebView 桌面常回退为瞬移),浏览器则正常。为两端一致,统一用 JS 实现。
 *
 *  缓动:easeOutQuart(`1-(1-t)^4`)——初始速度最大、随后持续减速,末段长尾收尾。
 *  关键是总时长要够长:收尾减速再明显,总时长太短也看不出"慢下来"。
 *  时长:按距离自适应——短距离快,长距离封顶 1000ms,保证收尾减速段有足够时长被感知。
 *
 *  中止语义:
 *  - 用户主动介入(wheel / 触摸 / 键盘滚动键)→ 触发 onDone(按当前实际位置校准)。
 *  - 外部 cancelSmoothScroll(再次跳转 / 组件卸载)→ 仅清理,不触发 onDone
 *    (调用方已主动接管,不应回弹到旧 onDone 逻辑)。
 */

/** easeOutQuart:初始速度最大、随后持续减速,末段长尾收尾。
 *  导数(速度)在 t→1 时趋于 0,末段减速平缓。 */
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

const MIN_MS = 300;
const MAX_MS = 1000;
/** 每 px 对应时长(ms),配合距离算总时长,再 clamp 到 [MIN_MS, MAX_MS]。 */
const MS_PER_PX = 0.6;

/** 进行中的滚动控制器 key,挂在元素上。同一元素新动画启动时取消旧动画。 */
const CTRL_KEY = "__smoothScrollCtrl";

/** 用户是否设置了"减少动画"系统偏好。
 *  命中时所有平滑滚动直接瞬移到目标(尊重无障碍偏好,JS 动画不受 CSS
 *  @media prefers-reduced-motion 控制,需在此显式短路)。 */
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface Controller {
  raf: number | null;
  cleanup: () => void;
}

interface SmoothScrollOpts {
  /** 滚动时长(ms);不传则按距离自适应。 */
  duration?: number;
  /** 动画结束回调:自然完成或被用户介入中止时触发;外部 cancel 不触发。 */
  onDone?: () => void;
}

/** 取消元素上正在进行的平滑滚动(若有),仅清理不触发 onDone。
 *  用户手动滚动接管 / 再次跳转 / 卸载时调用。 */
export function cancelSmoothScroll(el: HTMLElement): void {
  const ctrl = (
    el as unknown as Record<string, Controller | undefined>
  )[CTRL_KEY];
  if (ctrl) {
    if (ctrl.raf != null) cancelAnimationFrame(ctrl.raf);
    ctrl.cleanup();
    (el as unknown as Record<string, Controller | undefined>)[CTRL_KEY] = undefined;
  }
}

/**
 * 平滑滚动到指定 scrollTop 目标。
 * - 自动钳位到 [0, maxScroll]。
 * - 起止相同则立即 onDone,不启 rAF。
 * - 同元素新调用会取消上一次动画(不触发旧 onDone)。
 * - 用户主动介入(wheel / 触摸 / 键盘滚动键)时中止并触发 onDone:
 *   避免动画逐帧覆盖用户滚动导致"滚不动";onDone 用当前实际 scrollTop 校准。
 */
export function smoothScrollTo(
  el: HTMLElement,
  targetTop: number,
  opts: SmoothScrollOpts = {},
): void {
  cancelSmoothScroll(el);
  const max = el.scrollHeight - el.clientHeight;
  const target = Math.max(0, Math.min(max, targetTop));
  const start = el.scrollTop;
  const distance = Math.abs(target - start);
  if (distance < 1) {
    opts.onDone?.();
    return;
  }
  // 减少动画偏好:直接瞬移到目标,不走 rAF 动画
  if (prefersReducedMotion) {
    el.scrollTop = target;
    opts.onDone?.();
    return;
  }
  const duration = opts.duration ?? Math.min(MAX_MS, Math.max(MIN_MS, distance * MS_PER_PX));
  const t0 = performance.now();
  let finished = false;

  const ctrl: Controller = { raf: null, cleanup: () => {} };
  const store = el as unknown as Record<string, Controller | undefined>;
  store[CTRL_KEY] = ctrl;

  const finish = () => {
    if (finished) return;
    finished = true;
    ctrl.raf = null;
    store[CTRL_KEY] = undefined;
    ctrl.cleanup();
    opts.onDone?.();
  };
  const tick = (now: number) => {
    if (finished) return;
    const t = Math.min((now - t0) / duration, 1);
    el.scrollTop = start + (target - start) * easeOutQuart(t);
    if (t < 1) {
      ctrl.raf = requestAnimationFrame(tick);
    } else {
      el.scrollTop = target;
      finish();
    }
  };
  // 用户主动介入即中止(wheel:鼠标滚轮;touchstart:触屏;keydown:PgUp/Dn/Home/End/方向键/空格)
  const onKeyDown = (e: KeyboardEvent) => {
    if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(e.key)) {
      finish();
    }
  };
  ctrl.cleanup = () => {
    el.removeEventListener("wheel", finish, true);
    el.removeEventListener("touchstart", finish, true);
    el.removeEventListener("keydown", onKeyDown, true);
  };
  el.addEventListener("wheel", finish, { capture: true, passive: true });
  el.addEventListener("touchstart", finish, { capture: true, passive: true });
  el.addEventListener("keydown", onKeyDown, { capture: true });
  ctrl.raf = requestAnimationFrame(tick);
}

/**
 * 平滑相对滚动(基于当前 scrollTop 偏移)。
 * 用于"按一个 tab 宽度横滚"等相对位移场景。
 */
export function smoothScrollBy(
  el: HTMLElement,
  delta: number,
  opts: SmoothScrollOpts = {},
): void {
  smoothScrollTo(el, el.scrollTop + delta, opts);
}

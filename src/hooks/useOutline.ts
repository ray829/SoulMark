import { useCallback, useEffect, useRef, useState } from "react";
import { smoothScrollTo } from "../utils/scroll";

/** 大纲条目:标题元素引用 + 元数据。absTop 为标题在滚动容器文档坐标中的绝对 top。 */
export interface OutlineHeading {
  id: string;
  level: number; // 1~6
  text: string;
  el: HTMLHeadingElement;
  absTop: number;
}

/** 标题进入"当前章节"判定的垂直偏移。等于 scroll-margin-top(12px):
 *  点击跳转后标题停在 editor-wrap 视口顶下方 12px 处(紧贴 editor-header 底),
 *  高亮判定阈值 = 跳转停留位置,二者一致避免边界浮点误差导致高亮错位。
 *  editor-header 在 editor-wrap 之外(flex-shrink:0),不遮挡 wrap 内容,
 *  故 offset 只需匹配停留位置,无需额外避让。 */
const SCROLL_OFFSET = 12;
/** MutationObserver 重采防抖延迟:编辑时合并连续变更,避免频繁重算。
 *  200ms:连续打字时每停顿一次才重采(原 50ms 在长文档可感知卡顿);
 *  大纲非焦点区,200ms 延迟用户无感。 */
const RESCAN_DEBOUNCE = 200;
/** 点击跳转后暂停高亮更新的兜底时长(作为 scrollend 不可用时的回退)。 */
const SCROLL_LOCK_MS = 1000;
/** 图片 load/error 后重算 absTop 的防抖延迟:合并同一批图片加载完成,避免连续重排。 */
const IMG_LOAD_DEBOUNCE = 150;

/** 计算元素在滚动容器文档坐标中的绝对 top。
 *  scroll 时 el 与 container 的 rect 同步移动,scrollTop 反向补偿 → absTop 恒定。
 *  故 scroll 时无需重算 getBoundingClientRect,只比较缓存值与 scrollTop。 */
function getAbsTop(el: HTMLElement, container: HTMLElement): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
}

/** 从标题元素读取层级(H1~H6 → 1~6)与文本。 */
function readHeading(el: HTMLHeadingElement): { level: number; text: string } {
  const level = Number(el.tagName[1]);
  const text = el.textContent?.trim() ?? "";
  return { level: Number.isFinite(level) ? level : 1, text };
}

/** 文档大纲:采集标题、滚动高亮当前章节、点击跳转。
 *  - 采集:MutationObserver 监听容器子树,标题增删/切 Tab(setMarkdown 重建 DOM)均触发重采。
 *  - 高亮:scroll 时(复用 FloatingBall 的 rAF flag 节流)比较缓存的 absTop,找最后一个已进入的标题。
 *  - 跳转:scrollIntoView 靠标题的 scroll-margin-top 自动避让 editor-header。
 *
 *  与 React state 解耦:切 Tab 时 setMarkdown 不触发 listener,统一靠 DOM 变化感知,避免漏更新。 */
export function useOutline(scrollRef: React.RefObject<HTMLElement | null>) {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 动态底部补白:让最末标题也能滚到顶部(参考 Notion)。由 updatePadBottom 计算。 */
  const [padBottom, setPadBottom] = useState(0);

  // 最新 headings 副本:scroll 回调内读取,避免闭包过期
  const headingsRef = useRef<OutlineHeading[]>([]);
  headingsRef.current = headings;
  // 跳转动画期间锁定高亮更新
  const scrollLockRef = useRef(false);
  const observerRef = useRef<MutationObserver | null>(null);
  const rafTickRef = useRef(false);
  // 当前已应用的底部补白高度(供下次计算扣减,避免循环)
  const spacerRef = useRef(0);

  /** 采集容器内所有标题并计算 absTop。 */
  const rescan = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      setHeadings([]);
      return;
    }
    const els = Array.from(
      container.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6"),
    );
    // 过滤掉空标题(无文本)与隐藏元素(html 节点后处理前的占位等)
    const items: OutlineHeading[] = [];
    let idx = 0;
    for (const el of els) {
      const { level, text } = readHeading(el);
      if (!text) continue;
      items.push({
        id: `outline-h-${idx++}`,
        level,
        text,
        el,
        absTop: getAbsTop(el, container),
      });
    }
    // 签名比较:结构/文本未变时(如纯布局重排、resize 触发的重采)跳过 setHeadings,
    // 避免无谓重渲染。absTop 仅用于 scroll 时的 updateActive(读 ref),不进渲染,
    // 故始终更新 ref 即可。编辑改文本时签名会变 → 仍 setHeadings 更新列表。
    const sig = items.map((h) => `${h.level}:${h.text}`).join("\n");
    const prevSig = headingsRef.current
      .map((h) => `${h.level}:${h.text}`)
      .join("\n");
    if (sig !== prevSig) {
      setHeadings(items);
    }
    // 同步更新 ref,使 rAF 内的 updateActive/updatePadBottom 读到最新标题(含最新 absTop)
    headingsRef.current = items;
    // 重算后立即重判当前章节 + 重算底部补白
    requestAnimationFrame(() => {
      updateActive(container.scrollTop);
      updatePadBottom();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  /** 重新计算所有标题的 absTop(布局/resize 变化后,旧坐标失效)。
   *  absTop 不进渲染(刻度尺用 flex 均分、浮层 item 不依赖 absTop),故只更新 ref
   *  供 rAF 内的 updateActive 读取,不 setHeadings 以避免无谓重渲染。
   *  坐标失效后立即重判当前章节 + 重算补白(顺带修复 resize 后 active 错位直到下次 scroll 才修正)。 */
  const recomputeAbsTop = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    headingsRef.current = headingsRef.current.map((h) => ({
      ...h,
      absTop: getAbsTop(h.el, container),
    }));
    requestAnimationFrame(() => {
      updateActive(container.scrollTop);
      updatePadBottom();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  /** 动态计算底部补白:让最末标题也能滚到 offset 线(参考 Notion)。
   *
   *  目标:末标题滚到顶部 offset 线时,scrollTop = last.absTop - offset。
   *  所需总内容高度 = (last.absTop - offset) + clientHeight。
   *  当前 scrollHeight 已含已应用的补白(经 .milkdown padding-bottom)。
   *  故:补白_new = 所需总高度 - (scrollHeight - 上次补白)。
   *
   *  absTop 不受 padding-bottom 影响(补白在标题之下),计算稳定无循环。
   *  long文档末标题下方内容多 → 补白 0;短文档 → 补刚好够的量。 */
  const updatePadBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const list = headingsRef.current;
    if (list.length === 0) {
      if (spacerRef.current !== 0) {
        spacerRef.current = 0;
        setPadBottom(0);
      }
      return;
    }
    const last = list[list.length - 1];
    const clientHeight = container.clientHeight;
    // 已含补白的当前总高,扣除上次补白得"自然内容高度"
    const natural = container.scrollHeight - spacerRef.current;
    // 末标题滚到 offset 线所需的总内容高度
    const required = last.absTop - SCROLL_OFFSET + clientHeight;
    const needed = Math.max(0, required - natural);
    // 加 1px 容差避免 sub-pixel 导致差 1px 滚不到
    const finalNeeded = needed > 1 ? needed : 0;
    if (finalNeeded !== spacerRef.current) {
      spacerRef.current = finalNeeded;
      setPadBottom(finalNeeded);
    }
  }, [scrollRef]);

  /** 根据当前 scrollTop 判定当前章节:最后一个 absTop <= scrollTop + offset 的标题。
   *  +1px 容差:scrollIntoView 让标题停在 scroll-margin-top(=offset)处时,
   *  absTop ≈ scrollTop + offset,但浮点 sub-pixel 使 absTop 常比 threshold 大
   *  零点几像素,<= 边界判定失败 → 误选上一个标题。容差把边界纳入判定。 */
  const updateActive = useCallback((scrollTop: number) => {
    const list = headingsRef.current;
    if (list.length === 0) {
      setActiveId(null);
      return;
    }
    const threshold = scrollTop + SCROLL_OFFSET + 1;
    let current = list[0];
    for (let i = 0; i < list.length; i++) {
      if (list[i].absTop <= threshold) {
        current = list[i];
      } else break; // 升序排列,超出即停
    }
    setActiveId(current.id);
  }, []);

  // MutationObserver:容器子树变化(标题增删、切 Tab 重建 DOM)时防抖重采。
  // 编辑时连续变更会被 debounce 合并为一次 rescan。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(rescan, RESCAN_DEBOUNCE);
    };
    // 初次采集
    rescan();
    const obs = new MutationObserver(schedule);
    // childList+subtree:捕获标题节点的增删与文本变更(textContent 改动触发 childList of text node)
    observerRef.current = obs;
    obs.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      observerRef.current = null;
      if (timer) window.clearTimeout(timer);
    };
  }, [scrollRef, rescan]);

  // scroll 监听:rAF flag 节流(复用 FloatingBall 模式),跳转锁定期内跳过。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      if (scrollLockRef.current) return;
      if (rafTickRef.current) return;
      rafTickRef.current = true;
      requestAnimationFrame(() => {
        updateActive(container.scrollTop);
        rafTickRef.current = false;
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollRef, updateActive]);

  // 窗口 resize:布局/视口变化后 absTop 与补白均失效,防抖重算。
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // recomputeAbsTop 内已含 updateActive + updatePadBottom(坐标失效后重判 + 重算补白)
        recomputeAbsTop();
      }, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, [recomputeAbsTop]);

  // 图片加载:img load/error 后布局变化(图片撑开),旧 absTop 失效,防抖重算。
  // img 的 load/error 不冒泡,用 capture 阶段在容器上委托捕获。
  // 编辑器在 scrollRef 容器内(App.tsx wrapRef),事件能被捕获,无需 Editor 跨组件通信。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let timer: number | undefined;
    const onImgMutate = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        recomputeAbsTop();
      }, IMG_LOAD_DEBOUNCE);
    };
    container.addEventListener("load", onImgMutate, { capture: true });
    container.addEventListener("error", onImgMutate, { capture: true });
    return () => {
      container.removeEventListener("load", onImgMutate, { capture: true });
      container.removeEventListener("error", onImgMutate, { capture: true });
      if (timer) window.clearTimeout(timer);
    };
  }, [scrollRef, recomputeAbsTop]);

  /** 点击跳转:立即把当前项设为被点击标题(高亮即时跟随),
   *  再平滑滚动;锁定期间暂停滚动高亮更新,避免动画中途乱跳。
   *  锁定结束(滚动真正停止)后补算一次,使高亮与最终滚动位置对齐。
   *
   *  平滑滚动用自实现 smoothScrollTo(rAF + easeInOutCubic),而非原生
   *  el.scrollIntoView({behavior:"smooth"}):Tauri 桌面端 WKWebView/WebView2 对
   *  div 级滚动容器的 smooth 支持不可靠(常瞬移),浏览器则正常,故统一 JS 实现。
   *  落点 = absTop - scroll-margin-top(=SCROLL_OFFSET),与原生 block:start + scroll-margin-top 一致。
   *  解锁:动画 onDone 触发(scrollend 在自实现滚动下不保证触发,故用 onDone 兜底 + 定时器双保险)。 */
  const scrollToHeading = useCallback((el: HTMLHeadingElement, id: string) => {
    setActiveId(id);
    const container = scrollRef.current;
    if (!container) return;
    const target = getAbsTop(el, container) - SCROLL_OFFSET;
    scrollLockRef.current = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      scrollLockRef.current = false;
      // 滚动结束后按实际位置校准(补白若有偏差也能修正)
      updateActive(container.scrollTop);
    };
    smoothScrollTo(container, target, { onDone: finish });
    // 兜底:若 onDone 因元素卸载/被取消未触发,定时器解锁避免高亮永久冻结
    window.setTimeout(finish, SCROLL_LOCK_MS);
  }, [scrollRef, updateActive]);

  return { headings, activeId, padBottom, scrollToHeading };
}

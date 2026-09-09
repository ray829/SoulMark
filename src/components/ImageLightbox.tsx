import { useCallback, useEffect, useRef, useState } from "react";

/** 图片放大预览层:多级缩放 + 拖动平移。
 *
 * 缩放:
 *   - 滚轮(中心缩放,向上放大/向下缩小)
 *   - +/− 按钮(1.25 倍步进)、中间百分比按钮点按重置为 1x
 *   - 键盘 +/= 放大、-/_ 缩小、0 重置
 * 平移:放大后鼠标拖动图片、键盘方向键。
 * 切换:双击图片在 1x ↔ 2x 间切换。
 * 关闭:点背景、Esc。
 *
 * 每次 mount 重置(zoom=1, offset={0,0}):打开新图即为初始态,无需手动复位。
 * transform: translate(offset) scale(zoom),transform-origin center。父 .img-lightbox
 * overflow:hidden 裁切放大后超出部分,拖动查看局部。
 */

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;
const ZOOM_FACTOR = 1.1; // 按钮/键盘步进(单次)
const PAN_STEP = 80;
// 滚轮缩放灵敏度:每像素 deltaY 对应的缩放比例。触控板单次捏合产生大量小 deltaY,
// 若固定倍率会指数爆炸式跳变。改为按 deltaY 幅度线性缩放,小幅度 → 小步进,手感顺滑。
const WHEEL_SENSITIVITY = 0.0015;
// 触控板双指捏合(macOS 系统合成手势,带 ctrlKey:true,连续小 deltaY)灵敏度更高:
// 否则小 deltaY × 低灵敏度 → 缩放太慢。与鼠标滚轮(大 deltaY)分别调参。
const PINCH_SENSITIVITY = 0.012;
const WHEEL_DELTA_CAP = 100; // 单次 deltaY 截断,防止极端值一次缩太多

const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offX: 0, offY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z * ZOOM_FACTOR)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z / ZOOM_FACTOR)), []);
  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // 键盘:+/= 放大、-/_ 缩小、0 重置、Esc 关闭、方向键平移
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomOut();
          break;
        case "0":
          e.preventDefault();
          reset();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowLeft":
          e.preventDefault();
          setOffset((o) => ({ ...o, x: o.x + PAN_STEP }));
          break;
        case "ArrowRight":
          e.preventDefault();
          setOffset((o) => ({ ...o, x: o.x - PAN_STEP }));
          break;
        case "ArrowUp":
          e.preventDefault();
          setOffset((o) => ({ ...o, y: o.y + PAN_STEP }));
          break;
        case "ArrowDown":
          e.preventDefault();
          setOffset((o) => ({ ...o, y: o.y - PAN_STEP }));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, reset, onClose]);

  // 滚轮缩放:必须 passive:false 才能 preventDefault 阻止页面滚动;
  // 用 ref + addEventListener 而非 React onWheel(后者在部分 webview 为 passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 按 deltaY 幅度缩放(线性,非固定倍率):触控板小幅 deltaY → 小步进,鼠标滚轮
      // 大 deltaY → 大步进。deltaY<0 放大、>0 缩小。截断极端 deltaY 防一次缩太多。
      const delta = Math.max(-WHEEL_DELTA_CAP, Math.min(WHEEL_DELTA_CAP, e.deltaY));
      // macOS 触控板双指捏合:系统合成手势(ctrlKey:true)+ 连续小 deltaY。
      // 用更高灵敏度,否则小 deltaY × 低灵敏度 → 太慢。鼠标滚轮用低灵敏度。
      const sens = e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
      setZoom((z) => clampZoom(z * (1 - delta * sens)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 拖动平移:mousedown 落在图片上,move/up 挂 window(鼠标移出图片仍响应)
  const onImgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // 仅左键
      e.preventDefault();
      e.stopPropagation(); // 不冒泡到背景 onClick(避免拖动即关闭)
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        offX: offset.x,
        offY: offset.y,
      };
      setDragging(true);
    },
    [offset],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragStart.current;
      setOffset({ x: d.offX + (e.clientX - d.x), y: d.offY + (e.clientY - d.y) });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // 双击:1x ↔ 2x 切换(zoom≠1 时回到 1x)
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (zoom === 1) setZoom(2);
      else reset();
    },
    [zoom, reset],
  );

  const cursor = dragging ? "grabbing" : zoom > 1 ? "grab" : "default";

  return (
    <div ref={containerRef} className="img-lightbox" onClick={onClose}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        onMouseDown={onImgMouseDown}
        onDoubleClick={onDoubleClick}
        onClick={(e) => e.stopPropagation()} // 点图片不关闭(图片可拖动/双击)
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          cursor,
        }}
      />
      {/* 缩放控制条 */}
      <div className="lightbox-controls" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="lightbox-btn"
          onClick={zoomOut}
          title="缩小"
          aria-label="缩小"
          disabled={zoom <= ZOOM_MIN}
        >
          −
        </button>
        <button
          type="button"
          className="lightbox-btn zoom-label"
          onClick={reset}
          title="重置缩放"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="lightbox-btn"
          onClick={zoomIn}
          title="放大"
          aria-label="放大"
          disabled={zoom >= ZOOM_MAX}
        >
          +
        </button>
      </div>
    </div>
  );
}

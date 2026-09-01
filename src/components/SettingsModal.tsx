import { useState } from "react";
import { RangeSlider } from "./RangeSlider";
import { pickBackgroundImage } from "../services/background";
import { CloseIcon, ImageIcon } from "./icons";

/* 外观设置弹窗:自定义背景图 + 毛玻璃参数。
   复用 .modal / .modal-overlay(已毛玻璃化)。参数实时写 CSS 变量,调滑块即见预览。
   入口:悬浮球「外观设置」。 */

interface SettingsModalProps {
  bgImage: string;
  bgBlur: number;
  bgDim: number;
  glassBlur: number;
  glassOpacity: number;
  onSetBgImage: (url: string) => void;
  onSetBgBlur: (v: number) => void;
  onSetBgDim: (v: number) => void;
  onSetGlassBlur: (v: number) => void;
  onSetGlassOpacity: (v: number) => void;
  onReset: () => void;
  onClose: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const {
    bgImage,
    bgBlur,
    bgDim,
    glassBlur,
    glassOpacity,
    onSetBgImage,
    onSetBgBlur,
    onSetBgDim,
    onSetGlassBlur,
    onSetGlassOpacity,
    onReset,
    onClose,
  } = props;
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasBg = !!bgImage;

  // 选图:调系统对话框 → 拷贝到 appData → 转 asset URL → 写 CSS 变量
  const pick = async () => {
    setPicking(true);
    setError(null);
    try {
      const url = await pickBackgroundImage();
      if (url) onSetBgImage(url);
    } catch (e) {
      console.error("选择背景图失败", e);
      setError("无法加载该图片,请换一张试试");
    } finally {
      setPicking(false);
    }
  };

  // Esc 关闭
  // (modal-overlay 点击外部已关闭;Esc 由 overlay 焦点或全局监听处理,此处简化)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="modal-title">外观设置</span>
          <button
            className="editor-close"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <CloseIcon />
          </button>
        </div>

        {/* 背景图选择 */}
        <div className="settings-section">
          <div className="settings-section-title">背景图片</div>
          <div className="bg-actions">
            <button
              className="sidebar-btn"
              onClick={pick}
              disabled={picking}
              title="选择本地图片作为背景"
            >
              <ImageIcon />
              {picking ? "选择中…" : hasBg ? "更换图片" : "选择图片"}
            </button>
            {hasBg && (
              <button
                className="sidebar-btn"
                onClick={() => onSetBgImage("")}
                title="清除背景图"
              >
                清除
              </button>
            )}
          </div>
          {hasBg && (
            <div
              className="bg-preview"
              style={{ backgroundImage: `var(--bg-image)` }}
            />
          )}
          {error && <div className="bg-error">{error}</div>}
        </div>

        {/* 调节滑块:无背景图时,背景相关滑块禁用(毛玻璃仍可调,纯色底也有质感) */}
        <div className="settings-section">
          <div className="settings-section-title">调节</div>
          <RangeSlider
            label="背景虚化"
            value={bgBlur}
            min={0}
            max={40}
            onChange={onSetBgBlur}
            disabled={!hasBg}
          />
          <RangeSlider
            label="背景压暗"
            value={bgDim}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={onSetBgDim}
            disabled={!hasBg}
          />
          <RangeSlider
            label="磨砂强度"
            value={glassBlur}
            min={0}
            max={32}
            onChange={onSetGlassBlur}
          />
          <RangeSlider
            label="通透度"
            value={glassOpacity}
            min={0.4}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={onSetGlassOpacity}
          />
        </div>

        <div className="settings-actions">
          <button className="sidebar-btn" onClick={onReset} title="恢复默认外观">
            恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}

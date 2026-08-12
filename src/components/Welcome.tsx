import { EmptyMark } from "./icons";
import { modKey, shiftKey } from "../utils/platform";

interface WelcomeProps {
  /** 空状态主操作:打开文件 / 打开文件夹 */
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
}

/** 键位 */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Welcome({ onOpenFile, onOpenFolder }: WelcomeProps) {
  return (
    <div className="welcome" data-welcome="">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <EmptyMark />
        </div>
        <h1 className="welcome-title">还没有打开文件</h1>
        <p className="welcome-slogan">极简的 Markdown 阅读与写作</p>

        {/* 空状态主操作 */}
        <div className="welcome-actions">
          <button className="sidebar-btn primary" onClick={onOpenFile}>
            打开文件
          </button>
          <button className="sidebar-btn" onClick={onOpenFolder}>
            打开文件夹
          </button>
        </div>

        <section className="welcome-shortcuts">
          <h2 className="welcome-section-title">快捷键</h2>
          <div className="welcome-shortcut-list">
            <div className="welcome-shortcut">
              <Kbd>{modKey}N</Kbd>
              <span>新建</span>
            </div>
            <div className="welcome-shortcut">
              <Kbd>{modKey}O</Kbd>
              <span>打开</span>
            </div>
            <div className="welcome-shortcut">
              <Kbd>{modKey}S</Kbd>
              <span>保存</span>
            </div>
            <div className="welcome-shortcut">
              <Kbd>{modKey}{shiftKey}S</Kbd>
              <span>另存为</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Welcome;

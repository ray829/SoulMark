import { SleepingCat } from "./SleepingCat";

interface WelcomeProps {
  /** 空状态主操作:打开文件 / 打开文件夹 */
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
}

export function Welcome({ onOpenFile, onOpenFolder }: WelcomeProps) {
  return (
    <div className="welcome" data-welcome="">
      <div className="welcome-inner">
        <SleepingCat />

        {/* 空状态主操作 */}
        <div className="welcome-actions">
          <button className="sidebar-btn primary" onClick={onOpenFile}>
            打开文件
          </button>
          <button className="sidebar-btn" onClick={onOpenFolder}>
            打开文件夹
          </button>
        </div>
      </div>
    </div>
  );
}

export default Welcome;

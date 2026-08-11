import { baseName, parentDir } from "../utils/path";

/** 最近文件项（为 T4 预留：App 暂不传，则该区块不渲染） */
export interface RecentFile {
  path: string;
}

interface WelcomeProps {
  /** 点击最近文件项时触发；未提供则最近列表不渲染（即便 recents 非空） */
  onOpenRecent?: (path: string) => void;
  recents?: RecentFile[];
  /** 空状态主操作：打开文件 / 打开文件夹 */
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
}

/* 平台修饰键：mac 用 ⌘/⇧，其余用 Ctrl/Shift。模块级只算一次。 */
const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const M = isMac ? "⌘" : "Ctrl";
const S = isMac ? "⇧" : "Shift";

/** 空状态图形：带折角与文本行的文档图标 */
function EmptyMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
      <path d="M9 13h6M9 16h6M9 19h4" />
    </svg>
  );
}

/** 文件图标 */
function FileMarkdown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 16V8l3 4 3-4v8" />
    </svg>
  );
}

/** 键位 */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Welcome({ onOpenRecent, recents, onOpenFile, onOpenFolder }: WelcomeProps) {
  const showRecents = !!onOpenRecent && !!recents && recents.length > 0;

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

        {showRecents && onOpenRecent && (
          <section className="welcome-recents">
            <h2 className="welcome-section-title">最近打开</h2>
            <ul className="welcome-recent-list">
              {recents!.map((r) => (
                <li key={r.path}>
                  <button
                    className="welcome-recent-item"
                    onClick={() => onOpenRecent(r.path)}
                    title={r.path}
                  >
                    <FileMarkdown className="welcome-recent-icon" />
                    <span className="welcome-recent-meta">
                      <span className="welcome-recent-name">{baseName(r.path)}</span>
                      <span className="welcome-recent-path">{parentDir(r.path)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="welcome-shortcuts">
          <h2 className="welcome-section-title">快捷键</h2>
          <div className="welcome-shortcut-list">
            <div className="welcome-shortcut">
              <Kbd>{M}N</Kbd>
              <span>新建</span>
            </div>
            <div className="welcome-shortcut">
              <Kbd>{M}O</Kbd>
              <span>打开</span>
            </div>
            <div className="welcome-shortcut">
              <Kbd>{M}S</Kbd>
              <span>保存</span>
            </div>
            <div className="welcome-shortcut">
              <Kbd>{M}{S}S</Kbd>
              <span>另存为</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Welcome;

import { useState } from "react";
import type { DialogOpts } from "../hooks/useFileTree";

/** 输入名浮层(新建文件 / 文件夹)。重命名走 TreeNode 内联 input,不走这里。
 *  onConfirm 返回 false 时不关闭(重名等场景保留输入)。 */
export function PromptDialog({ opts, onClose }: { opts: DialogOpts; onClose: () => void }) {
  const [val, setVal] = useState(opts.value ?? "");
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    const v = val.trim();
    if (!v || submitting) return;
    setSubmitting(true);
    try {
      const ok = await opts.onConfirm(v);
      if (ok !== false) onClose();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{opts.title}</div>
        <input
          className="modal-input"
          autoFocus
          value={val}
          placeholder={opts.hint}
          disabled={submitting}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="modal-btn primary" onClick={() => void submit()} disabled={submitting}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromptDialog;

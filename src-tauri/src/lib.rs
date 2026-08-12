use std::path::Path;
#[cfg(windows)]
use tauri::Manager;

/// 安全删除:取代前端直连 `fs:allow-remove`。
/// 即便前端被注入恶意 JS,也无法越权删除家目录/系统根等危险路径。
///
/// 拦截规则(canonicalize 消除 `../`、符号链接等绕过):
/// - 系统根目录(parent 为 None)
/// - Windows 盘根(形如 `\\?\C:\`)
/// - 用户主目录
/// 其余路径按文件/目录类型删除,失败返回错误字符串供前端展示。
#[tauri::command]
fn safe_remove(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    let canon = p
        .canonicalize()
        .map_err(|e| format!("路径解析失败: {e}"))?;

    let s = canon.to_string_lossy();
    let lower = s.to_lowercase();

    // 系统根
    if canon.parent().is_none() || s == "/" {
        return Err("拒绝删除系统根目录".into());
    }
    // Windows 盘根(canonicalize 后形如 \\?\C:\)
    if lower.ends_with(":\\") {
        return Err("拒绝删除盘根目录".into());
    }
    // 用户主目录(最高频的灾难性误删)
    if let Some(home) = home_dir() {
        if let Ok(home_canon) = home.canonicalize() {
            if canon == home_canon {
                return Err("拒绝删除用户主目录".into());
            }
        }
    }

    log::info!("safe_remove: {canon:?}");
    if p.is_dir() {
        std::fs::remove_dir_all(&canon).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&canon).map_err(|e| e.to_string())
    }
}

/// 取用户主目录(Unix: $HOME,Windows: %USERPROFILE%)。best-effort,取不到则跳过家目录拦截。
fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![safe_remove])
        .setup(|app| {
            // Windows 无系统标题栏,由前端自绘窗口控制按钮;macOS 保留原生红绿灯
            #[cfg(windows)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.set_decorations(false) {
                        log::error!("set_decorations failed: {e}");
                    }
                }
            }
            // 非 windows 平台无需使用 app,显式标注消除未使用警告
            let _ = app;
            log::info!("Soul Mark backend started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

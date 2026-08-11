#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Windows 无系统标题栏,由前端自绘窗口控制按钮;macOS 保留原生红绿灯
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }
            #[cfg(not(windows))]
            let _ = app; // macOS 保留原生装饰,app 仅 Windows 使用
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

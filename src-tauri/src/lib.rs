use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use base64::Engine as _;

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

/// 图片代理:绕过图床防盗链。
///
/// 部分图床(如 haowallpaper.com)检查 Referer/Origin,对来自 webview 的请求
/// (Origin: tauri://localhost 或 http://localhost:1420)返回 403 防盗链。
/// 前端 <img> 和 fetch 都带 webview 的 Origin → 都被拦。
/// 此 command 在 Rust 侧用 reqwest 请求(默认不发 Referer/Origin),拿到图片字节后
/// 经 IPC 返回 base64,前端转 blob 显示。
///
/// 返回 (base64_bytes, content_type)。
#[tauri::command]
fn proxy_image(url: String) -> Result<(String, String), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .timeout(std::time::Duration::from_secs(15))
        .gzip(true) // 部分图床强制 gzip,reqwest 默认不解压 → blob 是 gzip 流,webview 解码失败
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp
        .bytes()
        .map_err(|e| format!("read body failed: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((b64, content_type))
}

/// 待打开文件队列:系统在应用启动/运行中通过文件关联投递的 .md 路径暂存于此,
/// 供前端冷启动时 invoke('opened_files') 拉取;同时通过 emit('opened-files') 推送。
/// 双保险:冷启动时事件可能先于前端 listen 注册到达 → state 兜底;热启动靠 emit。
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

/// 前端冷启动拉取:返回 Rust 端缓存的待打开文件路径(消费后不清空,
/// 因为前端可能未 ready 而暂存;路径去重由前端 openByPath 处理)。
#[tauri::command]
fn opened_files(app: tauri::AppHandle) -> Vec<String> {
    app.state::<PendingFiles>().0.lock().unwrap().clone()
}

/// 从命令行参数中提取 Markdown 文件路径:跳过选项(- / -- 开头)与 exe 名,
/// 收集扩展名为 .md / .markdown(大小写不敏感)的参数。
/// Windows:双击文件唤起应用时文件路径作为 argv 传入。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn extract_md_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| !a.starts_with('-'))
        .filter(|a| {
            let lower = a.to_ascii_lowercase();
            lower.ends_with(".md") || lower.ends_with(".markdown")
        })
        .cloned()
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles::default())
        .invoke_handler(tauri::generate_handler![safe_remove, opened_files, proxy_image])
        .setup(|app| {
            // Windows 冷启动:双击文件唤起应用,文件路径作为 argv 传入。
            // setup 早于前端 webview 加载,此处存入 state,前端 invoke 时可拿到。
            #[cfg(windows)]
            {
                let args: Vec<String> = std::env::args_os()
                    .skip(1)
                    .map(|a| a.to_string_lossy().into_owned())
                    .collect();
                let files = extract_md_args(&args);
                if !files.is_empty() {
                    app.state::<PendingFiles>()
                        .0
                        .lock()
                        .unwrap()
                        .extend(files);
                }
            }
            // 窗口 config 设 visible:false,此处装饰就绪后再 show(),避免 Windows 首帧原生标题栏闪烁
            // (set_decorations 在窗口首帧可见前完成)。Windows:去装饰 + 前端自绘控件;macOS 保留原生红绿灯。
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                {
                    if let Err(e) = window.set_decorations(false) {
                        log::error!("set_decorations failed: {e}");
                    }
                }
                let _ = window.show();
            }
            // 非 windows 平台 set_decorations 不调用,app 已用于 show,无需额外标注
            let _ = app;
            log::info!("Soul Mark backend started");
            Ok(())
        });

    // Windows/Linux:已运行实例被第二个实例唤起时,捕获命令行参数中的文件路径。
    // macOS 由系统保证单实例,文件打开事件走下方 RunEvent::Opened,无需此插件。
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        let args_vec: Vec<String> = args.into_iter().skip(1).collect();
        let files = extract_md_args(&args_vec);
        if !files.is_empty() {
            app.state::<PendingFiles>()
                .0
                .lock()
                .unwrap()
                .extend(files.clone());
            let _ = app.emit("opened-files", files);
        }
        // 把已运行窗口拉到前台
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS:通过文件关联打开(Launch Services)。冷启动与热启动均走此事件。
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect();
                    if !paths.is_empty() {
                        app.state::<PendingFiles>()
                            .0
                            .lock()
                            .unwrap()
                            .extend(paths.clone());
                        let _ = app.emit("opened-files", paths);
                    }
                }
            }
            // 非 macOS 平台:此回调目前不处理事件,显式标注消除未使用警告。
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        });
}

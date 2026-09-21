//! Main window construction and state events.

use serde::Serialize;
use std::sync::atomic::{ AtomicU8, Ordering };
use tauri::{ utils::config::WindowConfig, App, Emitter, WebviewWindowBuilder, Window, WindowEvent };

/// Must match `--titlebar-height` in App.css.
#[cfg(target_os = "macos")]
const TITLEBAR_HEIGHT: f64 = 48.0;

/// Traffic-light inset. The strip height is button height + y, and AppKit
/// centres the buttons in it, so y = 2 * (bar / 2) - button height.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS: (f64, f64) = (16.0, TITLEBAR_HEIGHT - 22.0);

pub const PLATFORM: &str = if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(target_os = "windows") {
    "windows"
} else {
    "linux"
};

/// Runs before page scripts, so the platform is known at first paint.
/// WebView2 may not have <html> yet, so main.tsx also copies the global.
fn init_script() -> String {
    format!(
        "window.__COSMOS_PLATFORM__='{p}';\
         if(document.documentElement)document.documentElement.dataset.platform='{p}';",
        p = PLATFORM
    )
}

pub fn create_main(app: &mut App) -> tauri::Result<()> {
    let config = WindowConfig { label: "main".into(), ..Default::default() };

    let builder = WebviewWindowBuilder::from_config(app, &config)?
        .title("Cosmos")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .resizable(true)
        .initialization_script(init_script());

    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHTS.0, TRAFFIC_LIGHTS.1));

    // Set at creation so the native frame never flashes.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false).shadow(true);

    builder.build()?;
    Ok(())
}

#[derive(Clone, Serialize)]
struct WindowState {
    fullscreen: bool,
    maximized: bool,
}

/// Emits `window-state` when fullscreen or maximized changes. Resize events
/// arrive continuously during a drag, so only transitions are forwarded.
pub fn on_event(window: &Window, event: &WindowEvent) {
    static LAST: AtomicU8 = AtomicU8::new(u8::MAX);

    if let WindowEvent::Resized(_) = event {
        let fullscreen = window.is_fullscreen().unwrap_or(false);
        let maximized = window.is_maximized().unwrap_or(false);
        let bits = (fullscreen as u8) | ((maximized as u8) << 1);
        if LAST.swap(bits, Ordering::Relaxed) != bits {
            let _ = window.emit("window-state", WindowState { fullscreen, maximized });
        }
    }
}

//! The Tauri shell. Agent traffic goes through the webview; the native side
//! owns the window, the macOS menu and token storage.

#[cfg(target_os = "macos")]
mod menu;
mod secrets;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder
        ::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(
            tauri::generate_handler![
                secrets::get_node_token,
                secrets::set_node_token,
                secrets::delete_node_token
            ]
        );

    // macOS only: on Windows and Linux a menu becomes a menubar under our
    // custom title bar.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::forward);

    builder
        .on_window_event(window::on_event)
        .setup(|app| {
            window::create_main(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

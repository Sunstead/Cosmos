//! The Tauri shell. Agent traffic goes through the webview; the native side
//! owns the window, the macOS menu and sign-in (which keeps the refresh
//! token in the keychain).

#[cfg(target_os = "macos")]
mod menu;
mod oidc;
mod secrets;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder
        ::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(
            tauri::generate_handler![
                oidc::oidc_sign_in,
                oidc::oidc_access_token,
                oidc::oidc_sign_out
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

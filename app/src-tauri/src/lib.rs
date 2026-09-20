//! The Tauri shell.
//!
//! Deliberately thin: all agent traffic goes through the webview's own
//! `fetch`/`EventSource`. The only native capability Cosmos needs is somewhere
//! safe to keep per-node agent tokens.

mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder
        ::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(
            tauri::generate_handler![
                secrets::get_node_token,
                secrets::set_node_token,
                secrets::delete_node_token
            ]
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

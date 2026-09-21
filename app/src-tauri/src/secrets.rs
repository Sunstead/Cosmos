//! Per-node agent tokens, stored in the operating system's credential store.
//!
//! macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
//! The alternative — `localStorage` — is plaintext and readable by any script
//! running in the webview, which is the wrong place for a credential that can
//! stop containers. The browser build has no keychain and falls back to
//! `localStorage`; that limitation is surfaced in Settings rather than hidden.

const SERVICE: &str = "net.sunstead.cosmos";

fn entry(node_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, node_id).map_err(|e| e.to_string())
}

/// `Ok(None)` for a node that has no stored token, which is the normal case
/// for an agent running with `allow_anonymous`.
#[tauri::command]
pub fn get_node_token(node_id: String) -> Result<Option<String>, String> {
    match entry(&node_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_node_token(node_id: String, token: String) -> Result<(), String> {
    entry(&node_id)?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_node_token(node_id: String) -> Result<(), String> {
    match entry(&node_id)?.delete_credential() {
        // Removing a node that never had a token is not an error.
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

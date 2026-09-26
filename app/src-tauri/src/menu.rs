//! Native macOS menu. Items emit a `menu` event carrying their id; the
//! frontend maps ids to actions (see src/lib/commands.ts).

use serde::Serialize;
use tauri::{
    menu::{ Menu, MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID },
    AppHandle,
    Emitter,
    Runtime,
};

#[derive(Clone, Serialize)]
struct MenuPayload<'a> {
    id: &'a str,
}

/// Id, label and accelerator; must match `SHORTCUTS` in `lib/shortcuts.ts`.
const PAGES: [(&str, &str, &str); 11] = [
    ("overview", "Overview", "CmdOrCtrl+1"),
    ("nodes", "Nodes", "CmdOrCtrl+2"),
    ("services", "Services", "CmdOrCtrl+3"),
    ("containers", "Containers", "CmdOrCtrl+4"),
    ("volumes", "Volumes", "CmdOrCtrl+5"),
    ("network", "Network", "CmdOrCtrl+6"),
    ("monitoring", "Monitoring", "CmdOrCtrl+7"),
    ("uptime", "Uptime", "CmdOrCtrl+Shift+U"),
    ("logs", "Logs", "CmdOrCtrl+8"),
    ("backups", "Backups", "CmdOrCtrl+9"),
    ("events", "Events", "CmdOrCtrl+Shift+E"),
];

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accel: Option<&str>
) -> tauri::Result<MenuItem<R>> {
    let b = MenuItemBuilder::with_id(id, text);
    match accel {
        Some(a) => b.accelerator(a),
        None => b,
    }.build(app)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "Cosmos")
        .about(None)
        .separator()
        .item(&item(app, "app.settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // A custom menu replaces the default one, so the edit items must be
    // restated or ⌘C/⌘V stop working in text fields.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "view.command-palette", "Command Palette", Some("CmdOrCtrl+K"))?)
        .item(&item(app, "view.toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?)
        .item(&item(app, "view.toggle-theme", "Toggle Theme", Some("CmdOrCtrl+Shift+L"))?)
        .separator()
        .item(&item(app, "view.reload", "Reload", Some("CmdOrCtrl+R"))?)
        .separator()
        .fullscreen()
        .build()?;

    let mut go = SubmenuBuilder::new(app, "Go");
    for (id, label, accel) in PAGES {
        go = go.item(&item(app, &format!("go.{id}"), label, Some(accel))?);
    }
    let go = go.build()?;

    let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .bring_all_to_front()
        .build()?;

    MenuBuilder::new(app).items(&[&app_menu, &edit, &view, &go, &window]).build()
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let _ = app.emit_to("main", "menu", MenuPayload { id: event.id().as_ref() });
}

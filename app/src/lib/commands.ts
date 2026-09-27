/** Native menu ids (src-tauri/src/menu.rs) to command ids. */
export function menuToCommand(menuId: string): string {
  switch (menuId) {
    case 'app.settings':
      return 'settings';
    case 'view.command-palette':
      return 'palette';
    case 'view.toggle-sidebar':
      return 'sidebar';
    case 'view.toggle-theme':
      return 'theme';
    case 'view.reload':
      return 'reload';
    default:
      return menuId; // go.* ids match shortcut ids
  }
}

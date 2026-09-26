import { useEffect } from 'react';
import { nodeDisplayName, onNewEvents, useNodeStore } from '@/stores/nodes';
import { useNotificationPrefs } from '@/stores/notifications';
import { alertsFor } from '@/lib/events';
import { deviceAlert } from '@/lib/device-alert';

/**
 * Notifies this device about new events, per its preference (Settings >
 * Notifications). History loaded on connect never notifies; only what
 * arrives while the app is running. Renders nothing.
 */
export function NotificationWatcher() {
  useEffect(
    () =>
      onNewEvents((nodeId, events) => {
        const node = useNodeStore.getState().nodes.find((n) => n.id === nodeId);
        const level = useNotificationPrefs.getState().level;
        for (const a of alertsFor(node ? nodeDisplayName(node) : nodeId, events, level, document.hasFocus())) {
          void deviceAlert(a.title, a.body, a.tone);
        }
      }),
    [],
  );
  return null;
}

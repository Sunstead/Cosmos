import { useEffect } from 'react';
import { NodeStatus } from '@/api/connection';
import { nodeDisplayName, onNodeStatusChange, useNodeStore } from '@/stores/nodes';
import { useNotificationPrefs } from '@/stores/notifications';
import { AlertTone, deviceAlert } from '@/lib/device-alert';
import { msToDuration } from '@/lib/time';

type Alert = (title: string, body: string, tone: AlertTone) => void;

/**
 * Times each node's drops. A drop starts on leaving `online`; retries
 * (`connecting`) still count as down. Says so once it has lasted `minutes()`,
 * and says when it's back only if it said it was down.
 */
export class UnreachableTracker {
  private downSince = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private announced = new Set<string>();

  constructor(
    private readonly alert: Alert,
    private readonly nameOf: (nodeId: string) => string | null,
    private readonly minutes: () => number,
  ) {}

  onStatus(nodeId: string, from: NodeStatus, to: NodeStatus) {
    if (to === 'online') {
      const since = this.downSince.get(nodeId);
      const name = this.nameOf(nodeId);
      if (this.announced.has(nodeId) && since !== undefined && name) {
        this.alert(`${name} is back`, `It was unreachable for ${msToDuration(Date.now() - since)}.`, 'success');
      }
      return this.clear(nodeId);
    }
    if (to === 'unauthorized') return this.clear(nodeId);
    if (from !== 'online' || this.downSince.has(nodeId)) return;

    const minutes = this.minutes();
    if (minutes <= 0) return;
    this.downSince.set(nodeId, Date.now());
    this.timers.set(
      nodeId,
      setTimeout(() => {
        const name = this.nameOf(nodeId);
        if (!name) return this.clear(nodeId); // removed meanwhile
        this.announced.add(nodeId);
        this.alert(`${name} is unreachable`, `It hasn't answered for ${minutes} minutes.`, 'error');
      }, minutes * 60_000),
    );
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private clear(nodeId: string) {
    clearTimeout(this.timers.get(nodeId));
    this.timers.delete(nodeId);
    this.downSince.delete(nodeId);
    this.announced.delete(nodeId);
  }
}

/**
 * Says when a node stops answering for a while, and when it's back. The node
 * can't report this itself, so this device does, while it's running.
 */
export function useUnreachableAlerts() {
  useEffect(() => {
    const tracker = new UnreachableTracker(
      (title, body, tone) => void deviceAlert(title, body, tone),
      (nodeId) => {
        const node = useNodeStore.getState().nodes.find((n) => n.id === nodeId);
        return node ? nodeDisplayName(node) : null;
      },
      () => useNotificationPrefs.getState().unreachableAfterMin,
    );
    const off = onNodeStatusChange((nodeId, from, to) => tracker.onStatus(nodeId, from, to));
    return () => {
      off();
      tracker.dispose();
    };
  }, []);
}

/**
 * Where the constellation's data comes from. The scene only sees this
 * interface, so the app feeds it from the stores and the dev preview from a
 * fixture. Structure (who is in the sky) arrives as snapshots, only when it
 * changes; live metrics arrive per node, straight from the host stream,
 * without going through React.
 */
import type { HostInfo } from '@/generated/HostInfo';
import type { WolItem, UptimeItem } from '@/api/queries';
import type { Device } from '@/lib/tailnet';
import { getConnection, nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { userFacingServices } from '@/lib/services';
import { serviceCheck } from '@/lib/uptime';
import { EMPTY_SNAPSHOT, moonState, NodeState, Snapshot } from './model';

export type HostListener = (host: HostInfo) => void;

export interface ConstellationSource {
  snapshot(): Snapshot;
  /** Called after the snapshot changes. */
  subscribe(fn: () => void): () => void;
  /** Live samples for one node; the latest is replayed on subscribe. */
  onHost(nodeId: string, fn: HostListener): () => void;
}

/**
 * Fans host samples out per node and keeps the latest, so the scene, the HUD
 * and the snapshot's memory sizes share one subscription per connection.
 */
export class HostHub {
  private listeners = new Map<string, Set<HostListener>>();
  private latest = new Map<string, HostInfo>();

  on(nodeId: string, fn: HostListener): () => void {
    let set = this.listeners.get(nodeId);
    if (!set) this.listeners.set(nodeId, (set = new Set()));
    set.add(fn);
    const last = this.latest.get(nodeId);
    if (last) fn(last);
    return () => set.delete(fn);
  }

  push(nodeId: string, host: HostInfo) {
    this.latest.set(nodeId, host);
    for (const fn of this.listeners.get(nodeId) ?? []) fn(host);
  }

  get(nodeId: string): HostInfo | undefined {
    return this.latest.get(nodeId);
  }

  forget(nodeId: string) {
    this.latest.delete(nodeId);
  }
}

/**
 * The app's source: the node and container stores, plus the polled tailnet,
 * Wake-on-LAN and uptime handed in by the hook that owns it. It listens to
 * the stores only while something subscribes, so it needs no disposing and
 * survives StrictMode's double mount.
 */
export class StoreSource implements ConstellationSource {
  private snap: Snapshot = EMPTY_SNAPSHOT;
  private signature = '';
  private listeners = new Set<() => void>();
  private hub = new HostHub();
  private connections = new Map<string, { conn: object; unsubscribe: () => void }>();
  private memory = new Map<string, number>();
  private devices: Device[] = [];
  private wol: WolItem[] = [];
  private checks: UptimeItem[] = [];
  private stops: (() => void)[] = [];

  snapshot(): Snapshot {
    if (!this.stops.length) this.rebuild();
    return this.snap;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    if (!this.stops.length) {
      this.stops.push(useNodeStore.subscribe(() => this.rebuild()));
      this.stops.push(useContainersStore.subscribe(() => this.rebuild()));
      this.rebuild();
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }

  onHost(nodeId: string, fn: HostListener): () => void {
    if (this.stops.length) this.attach(nodeId);
    return this.hub.on(nodeId, fn);
  }

  setNetwork(devices: Device[], wol: WolItem[]) {
    this.devices = devices;
    this.wol = wol;
    this.rebuild();
  }

  setUptime(checks: UptimeItem[]) {
    this.checks = checks;
    this.rebuild();
  }

  private stop() {
    for (const stop of this.stops) stop();
    this.stops = [];
    for (const { unsubscribe } of this.connections.values()) unsubscribe();
    this.connections.clear();
  }

  /** One host subscription per connection; a node added later is picked up on the next rebuild. */
  private attach(nodeId: string) {
    const conn = getConnection(nodeId);
    const current = this.connections.get(nodeId);
    if (current?.conn === conn) return;
    current?.unsubscribe();
    if (!conn) {
      this.connections.delete(nodeId);
      return;
    }
    const unsubscribe = conn.onHost((host) => {
      this.hub.push(nodeId, host);
      if (this.memory.get(nodeId) !== host.mem_total_bytes) {
        this.memory.set(nodeId, host.mem_total_bytes);
        this.rebuild();
      }
    });
    this.connections.set(nodeId, { conn, unsubscribe });
  }

  private rebuild() {
    const { nodes, meta } = useNodeStore.getState();
    const ids = new Set(nodes.map((n) => n.id));
    for (const [id, { unsubscribe }] of this.connections) {
      if (ids.has(id)) continue;
      unsubscribe();
      this.connections.delete(id);
      this.memory.delete(id);
      this.hub.forget(id);
    }
    if (this.stops.length) for (const n of nodes) this.attach(n.id);

    const services = userFacingServices(useContainersStore.getState().services).filter((s) => ids.has(s.nodeId));
    const wolByDevice = new Map(
      this.wol.filter((w) => w.target.tailnet_device).map((w) => [w.target.tailnet_device!, w.state]),
    );

    const next: Snapshot = {
      nodes: nodes.map((n) => ({
        id: n.id,
        name: nodeDisplayName(n),
        state: (meta[n.id]?.status ?? 'connecting') as NodeState,
        memBytes: this.memory.get(n.id) ?? null,
      })),
      moons: services.map((s) => ({
        nodeId: s.nodeId,
        service: s.key,
        name: s.name,
        state: moonState(s.status, serviceCheck(this.checks, s.nodeId, s.key)?.state === 'down'),
        url: s.url,
      })),
      // Devices that are Cosmos nodes are drawn as nodes already.
      probes: this.devices
        .filter((d) => d.nodeId === null)
        .map((d) => {
          const wol = wolByDevice.get(d.id);
          return {
            id: d.id,
            name: d.name,
            os: d.os,
            online: d.online,
            wol: wol === 'waking' ? 'waking' : wol ? 'asleep' : null,
          };
        }),
    };

    // Containers stream every 2 s; only a real change reaches the scene.
    const signature = JSON.stringify(next);
    if (signature === this.signature) return;
    this.signature = signature;
    this.snap = next;
    for (const fn of this.listeners) fn();
  }
}

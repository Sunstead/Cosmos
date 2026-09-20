import { AgentClient, AgentRequestError, LEGACY_CAPABILITIES } from './client';
import { Capabilities } from '@/generated/Capabilities';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { HostInfo } from '@/generated/HostInfo';
import { VolumeInfo } from '@/generated/VolumeInfo';

export type NodeStatus =
  | 'connecting'
  | 'online'
  | 'offline'
  /** Reachable, but the token is missing or wrong. Retrying won't help. */
  | 'unauthorized';

export interface NodeMeta {
  status: NodeStatus;
  capabilities: Capabilities;
  agentVersion: string | null;
  apiVersion: number;
  /** Why we're offline, for the UI to show rather than a bare dot. */
  error: string | null;
}

type Listener<T> = (value: T) => void;

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const LEGACY_CONTAINER_POLL_MS = 5_000;
const VOLUME_POLL_MS = 30_000;

/**
 * Everything one agent needs, owned in one place.
 *
 * Previously `useHostInfo` opened an `EventSource` per *call site*, so a node
 * rendered on the Nodes page had two streams (four under StrictMode), each
 * causing the agent to run an independent sampler. Here each node has exactly
 * one host stream and one container stream for as long as it exists, and
 * components attach listeners to them.
 *
 * This also owns reconnection. The browser's built-in EventSource retry only
 * covers a dropped connection — on a non-2xx response it closes permanently,
 * which is why a node that was down when the app started used to stay dark
 * forever.
 */
export class NodeConnection {
  readonly client: AgentClient;

  private hostSource: EventSource | null = null;
  private containerSource: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private volumeTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;

  private meta: NodeMeta = {
    status: 'connecting',
    capabilities: LEGACY_CAPABILITIES,
    agentVersion: null,
    apiVersion: 0,
    error: null,
  };

  private lastHost: HostInfo | null = null;
  private lastSeq = -1;

  private hostListeners = new Set<Listener<HostInfo>>();
  private containerListeners = new Set<Listener<ContainerInfo[]>>();
  private volumeListeners = new Set<Listener<VolumeInfo[]>>();
  private metaListeners = new Set<Listener<NodeMeta>>();
  /** Fires when the agent restarts, so stale history can be dropped. */
  private resetListeners = new Set<Listener<void>>();

  constructor(
    readonly nodeId: string,
    baseUrl: string,
    token: string | null,
  ) {
    this.client = new AgentClient(baseUrl, token);
  }

  // --- subscriptions --------------------------------------------------------

  onHost(fn: Listener<HostInfo>): () => void {
    this.hostListeners.add(fn);
    // Hand over the most recent sample immediately so a component mounting
    // mid-stream doesn't render empty for up to a second.
    if (this.lastHost) fn(this.lastHost);
    return () => this.hostListeners.delete(fn);
  }

  onContainers(fn: Listener<ContainerInfo[]>): () => void {
    this.containerListeners.add(fn);
    return () => this.containerListeners.delete(fn);
  }

  onVolumes(fn: Listener<VolumeInfo[]>): () => void {
    const wasEmpty = this.volumeListeners.size === 0;
    this.volumeListeners.add(fn);
    // Otherwise the first subscriber waits out a full 30s poll interval.
    if (wasEmpty && !this.stopped) void this.pollVolumes();
    return () => this.volumeListeners.delete(fn);
  }

  onMeta(fn: Listener<NodeMeta>): () => void {
    this.metaListeners.add(fn);
    fn(this.meta);
    return () => this.metaListeners.delete(fn);
  }

  onReset(fn: Listener<void>): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  getMeta(): NodeMeta {
    return this.meta;
  }

  getHost(): HostInfo | null {
    return this.lastHost;
  }

  private setMeta(patch: Partial<NodeMeta>) {
    const next = { ...this.meta, ...patch };
    if (
      next.status === this.meta.status &&
      next.error === this.meta.error &&
      next.agentVersion === this.meta.agentVersion &&
      next.capabilities === this.meta.capabilities
    ) {
      return;
    }
    this.meta = next;
    for (const fn of this.metaListeners) fn(next);
  }

  // --- lifecycle ------------------------------------------------------------

  setToken(token: string | null) {
    this.client.setToken(token);
    if (!this.stopped) {
      // Streams carry the token in their URL, so they have to be reopened.
      this.restart();
    }
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.teardown();
    this.setMeta({ status: 'connecting', error: null });
  }

  private restart() {
    this.teardown();
    this.attempt = 0;
    this.stopped = false;
    void this.connect();
  }

  private teardown() {
    this.hostSource?.close();
    this.containerSource?.close();
    this.hostSource = null;
    this.containerSource = null;

    for (const t of [this.pollTimer, this.volumeTimer]) if (t) clearInterval(t);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pollTimer = null;
    this.volumeTimer = null;
    this.retryTimer = null;
  }

  private scheduleRetry(reason: string) {
    if (this.stopped || this.retryTimer) return;

    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.setMeta({ status: 'offline', error: reason });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * Negotiates capabilities, verifies the token, then opens the streams.
   *
   * The explicit `getHost` probe exists because `EventSource` never exposes an
   * HTTP status — without it a 401 and a dead host are indistinguishable, and
   * we'd retry a wrong token forever instead of asking for a new one.
   */
  private async connect() {
    if (this.stopped) return;
    this.teardown();
    this.setMeta({ status: 'connecting', error: null });

    try {
      const info = await this.client.getInfo();
      this.setMeta({
        capabilities: info.capabilities,
        agentVersion: info.agent_version,
        apiVersion: info.api_version,
      });

      await this.client.getHost();
    } catch (e) {
      if (e instanceof AgentRequestError && e.isUnauthorized) {
        // Terminal until the token changes; setToken() restarts us.
        this.setMeta({
          status: 'unauthorized',
          error: 'This agent requires a token, or the saved one is wrong.',
        });
        return;
      }
      this.scheduleRetry(e instanceof Error ? e.message : 'unreachable');
      return;
    }

    if (this.stopped) return;
    this.openHostStream();
    this.openContainerStream();
    this.startVolumePolling();
  }

  private openHostStream() {
    const source = new EventSource(this.client.hostStreamUrl());
    this.hostSource = source;

    source.onmessage = (e) => {
      let info: HostInfo;
      try {
        info = JSON.parse(e.data) as HostInfo;
      } catch {
        return;
      }

      // A lower seq than last time means the agent restarted; whatever history
      // we hold is from a different process and its rate deltas don't join up.
      if (info.seq < this.lastSeq) {
        for (const fn of this.resetListeners) fn();
      }
      this.lastSeq = info.seq;
      this.lastHost = info;

      this.attempt = 0;
      this.setMeta({ status: 'online', error: null });
      for (const fn of this.hostListeners) fn(info);
    };

    source.onerror = () => {
      // readyState CONNECTING means the browser is retrying on its own, which
      // it does for a dropped connection. CLOSED means it has given up — an
      // HTTP error — and only our own backoff will bring it back.
      if (source.readyState === EventSource.CLOSED) {
        this.scheduleRetry('stream closed');
      }
    };
  }

  private openContainerStream() {
    if (this.meta.apiVersion < 1) {
      // Pre-0.2 agents have no container stream; fall back to polling.
      void this.pollContainers();
      this.pollTimer = setInterval(() => void this.pollContainers(), LEGACY_CONTAINER_POLL_MS);
      return;
    }

    const source = new EventSource(this.client.containersStreamUrl());
    this.containerSource = source;

    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { containers: ContainerInfo[] };
        for (const fn of this.containerListeners) fn(parsed.containers);
      } catch {
        /* malformed frame; the next one will do */
      }
    };

    // Container data is secondary — a failure here shouldn't mark the whole
    // node offline while host metrics are still arriving.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        this.containerSource = null;
        if (!this.pollTimer) {
          this.pollTimer = setInterval(
            () => void this.pollContainers(),
            LEGACY_CONTAINER_POLL_MS,
          );
        }
      }
    };
  }

  private async pollContainers() {
    try {
      const result = await this.client.getContainers();
      for (const fn of this.containerListeners) fn(result.containers);
    } catch {
      /* the host stream owns the online/offline decision */
    }
  }

  private startVolumePolling() {
    void this.pollVolumes();
    this.volumeTimer = setInterval(() => void this.pollVolumes(), VOLUME_POLL_MS);
  }

  private async pollVolumes() {
    if (this.volumeListeners.size === 0) return;
    try {
      const result = await this.client.getVolumes();
      for (const fn of this.volumeListeners) fn(result.volumes);
    } catch {
      /* volumes are not worth changing node status over */
    }
  }
}

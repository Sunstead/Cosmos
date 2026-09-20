import { AgentInfo } from '@/generated/AgentInfo';
import { ApiError } from '@/generated/ApiError';
import { BackupsStatus } from '@/generated/BackupsStatus';
import { ContainerActionResult } from '@/generated/ContainerActionResult';
import { ContainersResponse } from '@/generated/ContainersResponse';
import { HostInfo } from '@/generated/HostInfo';
import { LogsResponse } from '@/generated/LogsResponse';
import { MetricSeries } from '@/generated/MetricSeries';
import { MetricStep } from '@/generated/MetricStep';
import { VolumesResponse } from '@/generated/VolumesResponse';
import { Capabilities } from '@/generated/Capabilities';

/** A typed failure from an agent, carrying the agent's own error code. */
export class AgentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `request failed with ${status}`);
    this.name = 'AgentRequestError';
  }

  get code() {
    return this.body?.code ?? null;
  }

  /** 401: the token is missing or wrong. Prompt, don't retry. */
  get isUnauthorized() {
    return this.status === 401;
  }

  /**
   * 501 means the feature is switched off on this agent and never will be —
   * hide it. 503 means it's configured but failing right now — retry.
   */
  get isPermanentlyUnavailable() {
    return this.status === 501;
  }
}

/** What a pre-0.2 agent (no /v1/info route) is assumed to support. */
export const LEGACY_CAPABILITIES: Capabilities = {
  host_metrics: true,
  containers: true,
  container_actions: false,
  container_logs: false,
  websocket_logs: false,
  volumes: true,
  volume_actions: false,
  metrics_history: false,
  backups: false,
};

export class AgentClient {
  constructor(
    readonly baseUrl: string,
    private token: string | null = null,
  ) {}

  setToken(token: string | null) {
    this.token = token;
  }

  private headers(): HeadersInit {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /**
   * EventSource and WebSocket cannot set request headers, so streaming URLs
   * carry the token in the query string. The agent accepts either.
   */
  private streamUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (this.token) url.searchParams.set('token', this.token);
    return url.toString();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });

    if (!res.ok) {
      let body: ApiError | null = null;
      try {
        body = (await res.json()) as ApiError;
      } catch {
        // Not every failure comes from the agent — a proxy in front of it may
        // return HTML.
      }
      throw new AgentRequestError(res.status, body);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // --- capability negotiation ---------------------------------------------

  /**
   * Unauthenticated probe. A 404 here means a pre-0.2 agent that predates the
   * route, so we fall back to the original read-only endpoint set rather than
   * failing outright.
   */
  async getInfo(): Promise<AgentInfo> {
    try {
      return await this.request<AgentInfo>('/v1/info');
    } catch (e) {
      if (e instanceof AgentRequestError && e.status === 404) {
        return {
          agent_version: '0.1.x',
          api_version: 0,
          auth_required: false,
          node_name: null,
          capabilities: LEGACY_CAPABILITIES,
        };
      }
      throw e;
    }
  }

  // --- reads ---------------------------------------------------------------

  getHost(): Promise<HostInfo> {
    return this.request<HostInfo>('/v1/host');
  }

  getContainers(): Promise<ContainersResponse> {
    return this.request<ContainersResponse>('/v1/containers');
  }

  getVolumes(): Promise<VolumesResponse> {
    return this.request<VolumesResponse>('/v1/volumes');
  }

  getBackups(): Promise<BackupsStatus> {
    return this.request<BackupsStatus>('/v1/backups');
  }

  getMetrics(opts: {
    from?: number;
    to?: number;
    step?: MetricStep;
    maxPoints?: number;
  }): Promise<MetricSeries> {
    const params = new URLSearchParams();
    if (opts.from !== undefined) params.set('from', String(Math.floor(opts.from)));
    if (opts.to !== undefined) params.set('to', String(Math.floor(opts.to)));
    if (opts.step) params.set('step', opts.step);
    if (opts.maxPoints) params.set('max_points', String(opts.maxPoints));
    return this.request<MetricSeries>(`/v1/metrics?${params}`);
  }

  getLogs(id: string, opts: { tail?: number; since?: number } = {}): Promise<LogsResponse> {
    const params = new URLSearchParams();
    if (opts.tail) params.set('tail', String(opts.tail));
    if (opts.since) params.set('since', String(Math.floor(opts.since)));
    return this.request<LogsResponse>(
      `/v1/containers/${encodeURIComponent(id)}/logs?${params}`,
    );
  }

  // --- actions -------------------------------------------------------------

  containerAction(
    id: string,
    action: 'start' | 'stop' | 'restart',
    timeoutSecs?: number,
  ): Promise<ContainerActionResult> {
    return this.request<ContainerActionResult>(
      `/v1/containers/${encodeURIComponent(id)}/${action}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout_secs: timeoutSecs ?? null }),
      },
    );
  }

  removeContainer(
    id: string,
    opts: { force?: boolean; volumes?: boolean } = {},
  ): Promise<ContainerActionResult> {
    const params = new URLSearchParams();
    if (opts.force) params.set('force', 'true');
    if (opts.volumes) params.set('volumes', 'true');
    return this.request<ContainerActionResult>(
      `/v1/containers/${encodeURIComponent(id)}?${params}`,
      { method: 'DELETE' },
    );
  }

  removeVolume(name: string, force = false): Promise<void> {
    const params = new URLSearchParams();
    if (force) params.set('force', 'true');
    return this.request<void>(`/v1/volumes/${encodeURIComponent(name)}?${params}`, {
      method: 'DELETE',
    });
  }

  // --- streams -------------------------------------------------------------

  hostStreamUrl(): string {
    return this.streamUrl('/v1/host/stream');
  }

  containersStreamUrl(): string {
    return this.streamUrl('/v1/containers/stream');
  }

  /** WebSocket URL for following a container's logs. */
  logsSocketUrl(id: string, opts: { tail?: number } = {}): string {
    const http = this.streamUrl(`/v1/containers/${encodeURIComponent(id)}/logs/ws`, {
      tail: String(opts.tail ?? 500),
    });
    return http.replace(/^http/, 'ws');
  }
}

import { AgentInfo } from '@/generated/AgentInfo';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { HostInfo } from '@/generated/HostInfo';

export function hostInfo(partial: Partial<HostInfo> = {}): HostInfo {
  return {
    name: 'jupiter',
    hostname: 'jupiter.local',
    os: 'Debian GNU/Linux 12',
    kernel: '6.1.0',
    arch: 'x86_64',
    cpu_model: 'AMD Ryzen 7',
    cpu_physical_cores: 8,
    cpu_logical_cores: 16,
    cpu_freq_mhz: 3800,
    mem_total_bytes: 32 * 1024 ** 3,
    swap_total_bytes: 0,
    cpu_pct: 12,
    cpu_per_core: [10, 14],
    mem_used_bytes: 8 * 1024 ** 3,
    swap_used_bytes: 0,
    load1: 0.5,
    load5: 0.4,
    load15: 0.3,
    disk: [],
    nets: [],
    net_rx_bps: 0,
    net_tx_bps: 0,
    uptime_secs: 3600,
    sampled_at: 1_700_000_000,
    seq: 1,
    ...partial,
  };
}

export function agentInfo(partial: Partial<AgentInfo> = {}): AgentInfo {
  return {
    agent_version: '0.2.0',
    api_version: 1,
    auth_required: true,
    node_name: 'jupiter',
    capabilities: {
      host_metrics: true,
      containers: true,
      container_actions: true,
      container_logs: true,
      websocket_logs: true,
      volumes: true,
      volume_actions: true,
      metrics_history: true,
      backups: true,
    },
    ...partial,
  };
}

export function containerInfo(partial: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: 'c1',
    name: 'gitea',
    image: 'gitea/gitea',
    status: 'Up 2 hours',
    state: 'running',
    ports: [],
    started_at: null,
    created_unix: 0,
    restart_count: 0,
    compose_project: null,
    cosmos_service: null,
    cosmos_service_description: null,
    cosmos_service_url: null,
    cpu_pct: 0,
    mem_used_bytes: 0,
    mem_limit_bytes: 0,
    ...partial,
  };
}

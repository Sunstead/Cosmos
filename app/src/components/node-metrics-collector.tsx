import { useEffect } from 'react';
import { useHostInfo } from '@/api/queries';
import { useMetricsHistory } from '@/stores/metrics-history';

interface Props {
  nodeId: string;
}

export function NodeMetricsCollector({ nodeId }: Props) {
  const { data: host } = useHostInfo(nodeId);
  const push = useMetricsHistory((s) => s.push);

  useEffect(() => {
    if (!host) return;

    const diskRead = host.disk.reduce((sum, d) => sum + d.read_mbps, 0);
    const diskWrite = host.disk.reduce((sum, d) => sum + d.write_mbps, 0);

    push(nodeId, {
      cpu: host.cpu_pct,
      ram: (host.mem_used_gb / host.mem_total_gb) * 100,
      netRx: host.net_rx_mbps,
      netTx: host.net_tx_mbps,
      diskRead,
      diskWrite,
    });
  }, [host]);

  return null;
}
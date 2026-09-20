import { useEffect } from 'react';
import { useHostInfo } from '@/api/queries';
import { useMetricsHistory } from '@/stores/metrics-history';
import { getMemUsagePct, sumDisk } from '@/lib/node-metrics';

interface Props {
  nodeId: string;
}

export function NodeMetricsCollector({ nodeId }: Props) {
  const { data: host } = useHostInfo(nodeId);
  const push = useMetricsHistory((s) => s.push);

  useEffect(() => {
    if (!host) return;

    // Raw bytes/sec, matching the wire format. Formatting happens at the
    // point of display, not here.
    push(nodeId, {
      cpu: host.cpu_pct,
      ram: getMemUsagePct(host),
      netRx: host.net_rx_bps,
      netTx: host.net_tx_bps,
      diskRead: sumDisk(host, 'read_bps'),
      diskWrite: sumDisk(host, 'write_bps'),
    });
  }, [host]);

  return null;
}
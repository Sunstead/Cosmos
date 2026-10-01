import { useEffect, useState } from 'react';
import { useTailnet, useUptime, useWol } from '@/api/queries';
import { StoreSource } from '@/lib/constellation/source';

/**
 * The constellation's data, from the stores plus the polled tailnet,
 * Wake-on-LAN and uptime. Those polls re-render this hook's owner when they
 * change (every 10 s or more), never per sample.
 */
export function useConstellationSource(): StoreSource {
  const [source] = useState(() => new StoreSource());
  const { devices } = useTailnet();
  const { items: wol } = useWol();
  const { items: checks } = useUptime(60_000);

  useEffect(() => source.setNetwork(devices, wol), [source, devices, wol]);
  useEffect(() => source.setUptime(checks), [source, checks]);
  return source;
}

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useWol } from '@/api/queries';
import { WolState } from '@/generated/WolState';

/**
 * Says when a wake finishes, whichever page you're on. Renders nothing; the
 * query it reads is the same one the Network page uses, so it adds no polling
 * there.
 */
export function WolWatcher() {
  const { items } = useWol();
  const previous = useRef(new Map<string, WolState>());

  useEffect(() => {
    const seen = previous.current;
    for (const item of items) {
      const key = `${item.nodeId}:${item.target.id}`;
      const before = seen.get(key);
      seen.set(key, item.state);
      if (before !== 'waking' || item.state === 'waking') continue;

      const name = item.target.name;
      if (item.state === 'awake') {
        const took = item.last_wake?.took_secs;
        toast.success(`${name} is awake`, {
          description: took != null ? `Took ${took}s after the packet.` : undefined,
        });
      } else if (item.state === 'did_not_wake') {
        toast.error(`${name} did not wake`, {
          description: 'Check Wake-on-LAN is on in its BIOS and network adapter settings.',
        });
      }
    }
  }, [items]);

  return null;
}

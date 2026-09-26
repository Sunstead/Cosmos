import { Copy, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';

export interface SetupInfo {
  /** One short sentence. */
  summary: string;
  /** Config line to add, shown in a copyable block. */
  snippet?: string;
  /** Where the snippet goes, e.g. `agent.toml`. */
  file?: string;
}

/** A `?` button revealing the one thing needed to enable a feature. */
export function SetupHint({ info, label = 'How to enable' }: { info: SetupInfo; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='icon-xs' aria-label={label} className='text-muted-foreground'>
          <HelpCircle />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-80 space-y-3 text-sm'>
        <p>{info.summary}</p>
        {info.snippet && (
          <div className='space-y-1'>
            {info.file && <p className='text-xs text-muted-foreground'>{info.file}</p>}
            <div className='selectable flex items-start gap-2 rounded-md bg-muted p-2 font-mono text-xs'>
              <pre className='flex-1 whitespace-pre-wrap break-all'>{info.snippet}</pre>
              <Button
                variant='ghost'
                size='icon-xs'
                aria-label='Copy'
                onClick={() => void copyText(info.snippet!, 'Copied to clipboard')}
              >
                <Copy />
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Setup instructions shared across pages. */
export const SETUP = {
  history: {
    summary: 'Enable metrics history on the agent.',
    file: 'agent.toml',
    snippet: '[history]\nenabled = true',
  },
  events: {
    summary: 'Update the agent to 0.5 or later, and give it a writable state path. The event log is on by default.',
    file: 'agent.toml',
    snippet: '[events]\nenabled = true\n\n[state]\npath = "/var/lib/cosmos-agent/state.db"',
  },
  backups: {
    summary: 'Enable backups on the agent, then call cosmos-backup-status.sh at the end of your backup job.',
    file: 'agent.toml',
    snippet: '[backups]\nenabled = true\nstatus_file = "/host/backups/restic-status.json"',
  },
  logs: {
    summary: 'Enable log streaming on the agent.',
    file: 'agent.toml',
    snippet: '[docker]\nallow_logs = true',
  },
  actions: {
    summary: 'Allow container and volume actions on the agent.',
    file: 'agent.toml',
    snippet: '# above the first [section]\nallow_actions = true',
  },
  tailnet: {
    summary: 'Share the host tailscaled socket with the agent, then enable it. The agent gets read-only access.',
    file: 'agent.toml',
    snippet: '[tailscale]\nenabled = true\nsocket = "/host/tailscale/tailscaled.sock"',
  },
  wol: {
    summary: 'Turn on Wake-on-LAN on the agent of a node on the same LAN. Waking also needs allow_actions.',
    file: 'agent.toml',
    snippet: '[wol]\nenabled = true',
  },
  wolWindows: {
    summary:
      'For a Windows PC: enable Wake-on-LAN in the BIOS, turn on Wake on Magic Packet in the network adapter settings, and turn off Fast Startup.',
  },
  services: {
    summary: 'Group containers into a service with a Docker label.',
    file: 'docker-compose.yml',
    snippet: 'labels:\n  cosmos.service: gitea\n  cosmos.service.url: gitea.example.com',
  },
} satisfies Record<string, SetupInfo>;

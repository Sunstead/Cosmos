import { useState } from 'react';
import { Info, KeyRound, Monitor, Moon, PencilLine, RefreshCw, Sun, Trash } from 'lucide-react';
import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import { useNodeMeta } from '@/api/queries';
import { useTheme, Theme } from '@/components/theme-provider';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/section';
import { SegmentedControl } from '@/components/segmented-control';
import { NodeStatusBadge } from '@/components/node-status-badge';
import { NodeAvatar } from '@/components/node-planet';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { NodeCredentialsDialog } from '@/components/node-credentials-dialog';
import { RenameNodeDialog } from '@/components/rename-node-dialog';
import { AddNodeButton, EmptyState } from '@/components/empty-state';
import { Hint, ShortcutKeys } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PAGES } from '@/lib/navigation';
import { ShortcutId } from '@/lib/shortcuts';
import { getPlatform, isDesktop } from '@/lib/platform';
import { ServerOff } from 'lucide-react';

const CAPS = [
  ['container_actions', 'Actions'],
  ['container_logs', 'Logs'],
  ['metrics_history', 'History'],
  ['backups', 'Backups'],
  ['tailnet', 'Tailnet'],
] as const;

function NodeRow({ nodeId }: { nodeId: string }) {
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));
  const removeNode = useNodeStore((s) => s.removeNode);
  const reconnect = useNodeStore((s) => s.reconnect);
  const meta = useNodeMeta(nodeId);
  const [dialog, setDialog] = useState<'token' | 'rename' | null>(null);

  if (!node) return null;
  const name = nodeDisplayName(node);

  return (
    <div className='flex items-center gap-3 px-4 py-3'>
      <NodeAvatar nodeId={nodeId} size={32} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <p className='truncate font-medium'>{name}</p>
          <NodeStatusBadge nodeId={nodeId} />
        </div>
        <div className='flex flex-wrap items-center gap-1.5 pt-0.5'>
          <span className='selectable font-mono text-2xs text-muted-foreground'>{node.url}</span>
          {meta?.agentVersion && (
            <Badge variant='outline' className='font-mono text-2xs'>
              v{meta.agentVersion}
            </Badge>
          )}
          {meta?.status === 'online' &&
            CAPS.filter(([key]) => meta.capabilities[key]).map(([key, label]) => (
              <Badge key={key} variant='secondary' className='text-2xs'>
                {label}
              </Badge>
            ))}
        </div>
      </div>

      <div className='flex items-center gap-1'>
        <Hint label='Rename'>
          <Button variant='ghost' size='icon' aria-label='Rename' onClick={() => setDialog('rename')}>
            <PencilLine />
          </Button>
        </Hint>
        <Hint label='Token'>
          <Button variant='ghost' size='icon' aria-label='Token' onClick={() => setDialog('token')}>
            <KeyRound />
          </Button>
        </Hint>
        <Hint label='Reconnect'>
          <Button variant='ghost' size='icon' aria-label='Reconnect' onClick={() => reconnect(nodeId)}>
            <RefreshCw />
          </Button>
        </Hint>
        <ConfirmDialog
          trigger={
            <Button variant='ghost' size='icon' aria-label='Remove'>
              <Trash />
            </Button>
          }
          title={`Remove ${name}?`}
          description='Cosmos forgets this node and its token. The node itself is unchanged.'
          confirmLabel='Remove'
          onConfirm={() => removeNode(nodeId)}
        />
      </div>

      <NodeCredentialsDialog
        nodeId={nodeId}
        open={dialog === 'token'}
        onOpenChange={(o) => setDialog(o ? 'token' : null)}
      />
      <RenameNodeDialog
        nodeId={nodeId}
        open={dialog === 'rename'}
        onOpenChange={(o) => setDialog(o ? 'rename' : null)}
      />
    </div>
  );
}

function TokenStorageInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='icon-xs' aria-label='About token storage'>
          <Info />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 text-sm'>
        {isDesktop()
          ? 'Tokens are stored in your system keychain.'
          : 'In the browser, tokens are kept in local storage. Use the desktop app for stronger protection.'}
      </PopoverContent>
    </Popover>
  );
}

const SHORTCUT_ROWS: { id: ShortcutId; label: string }[] = [
  { id: 'palette', label: 'Command palette' },
  { id: 'search', label: 'Search this page' },
  { id: 'sidebar', label: 'Toggle sidebar' },
  { id: 'theme', label: 'Toggle theme' },
  { id: 'settings', label: 'Settings' },
  ...PAGES.filter((p) => p.shortcut.startsWith('go.')).map((p) => ({
    id: p.shortcut,
    label: `Go to ${p.label}`,
  })),
];

const PLATFORM_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux', web: 'Browser' };

export function SettingsPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const { theme, setTheme } = useTheme();

  return (
    <>
      <PageHeader title='Settings' />

      <Section
        title={
          <>
            Nodes
            <TokenStorageInfo />
          </>
        }
        count={nodes.length || undefined}
        actions={<AddNodeButton variant='outline' />}
        contentClassName='divide-y'
      >
        {nodes.length === 0 ? (
          <EmptyState size='inline' icon={ServerOff} title='No nodes yet' />
        ) : (
          nodes.map((n) => <NodeRow key={n.id} nodeId={n.id} />)
        )}
      </Section>

      <div className='grid gap-4 @4xl:grid-cols-2'>
        <Section title='Appearance' contentClassName='flex items-center justify-between gap-4 p-4'>
          <span className='text-sm'>Theme</span>
          <SegmentedControl<Theme>
            label='Theme'
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'system', label: 'System', icon: Monitor },
            ]}
          />
        </Section>

        <Section title='About' contentClassName='space-y-2 p-4 text-sm'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Version</span>
            <span className='font-mono tabular-nums'>{__APP_VERSION__}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Platform</span>
            <span>{PLATFORM_LABEL[getPlatform()]}</span>
          </div>
        </Section>
      </div>

      <Section title='Keyboard shortcuts' contentClassName='grid @2xl:grid-cols-2'>
        {SHORTCUT_ROWS.map((r) => (
          <div key={r.id} className='flex items-center justify-between border-b px-4 py-2 text-sm'>
            <span className='text-muted-foreground'>{r.label}</span>
            <ShortcutKeys id={r.id} />
          </div>
        ))}
      </Section>
    </>
  );
}

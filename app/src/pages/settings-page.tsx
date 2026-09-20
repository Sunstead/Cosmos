import { KeyRound, MonitorCog, RefreshCw, Server, Trash } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useNodeMeta } from '@/api/queries';
import { PageHeader } from '@/components/page-header';
import { NodeStatusBadge } from '@/components/node-status-badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { ConfirmDialog } from '@/components/confirm-dialog';
import AddNode from '@/components/add-node';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { isTauri } from '@/lib/tauri';
import { useState } from 'react';
import { NodeCredentialsDialog } from '@/components/node-credentials-dialog';

function NodeRow({ nodeId }: { nodeId: string }) {
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));
  const removeNode = useNodeStore((s) => s.removeNode);
  const reconnect = useNodeStore((s) => s.reconnect);
  const meta = useNodeMeta(nodeId);
  const [editingToken, setEditingToken] = useState(false);

  if (!node) return null;

  const caps = meta?.capabilities;
  const enabled = caps
    ? (
        [
          ['actions', caps.container_actions],
          ['logs', caps.container_logs],
          ['history', caps.metrics_history],
          ['backups', caps.backups],
        ] as const
      ).filter(([, on]) => on)
    : [];

  return (
    <div className='flex items-start justify-between gap-4 border-t py-4 first:border-t-0'>
      <div className='min-w-0 space-y-1'>
        <div className='flex items-center gap-2'>
          <p className='font-medium truncate'>{node.name}</p>
          <NodeStatusBadge nodeId={nodeId} />
        </div>
        <p className='text-xs text-muted-foreground font-mono truncate'>{node.url}</p>

        <div className='flex flex-wrap items-center gap-1.5 pt-1'>
          {meta?.agentVersion && (
            <Badge variant='outline' className='font-mono text-[10px]'>
              agent {meta.agentVersion}
            </Badge>
          )}
          {enabled.map(([label]) => (
            <Badge key={label} variant='secondary' className='text-[10px]'>
              {label}
            </Badge>
          ))}
          {meta && meta.apiVersion === 0 && (
            <Badge variant='outline' className='text-[10px] text-warning'>
              legacy API
            </Badge>
          )}
        </div>

        {meta?.error && <p className='text-xs text-error pt-1'>{meta.error}</p>}
      </div>

      <div className='flex items-center gap-1 shrink-0'>
        <Button variant='ghost' size='icon' onClick={() => setEditingToken(true)} title='Token'>
          <KeyRound />
        </Button>
        <Button variant='ghost' size='icon' onClick={() => reconnect(nodeId)} title='Reconnect'>
          <RefreshCw />
        </Button>
        <ConfirmDialog
          trigger={
            <Button variant='ghost' size='icon' title='Remove'>
              <Trash />
            </Button>
          }
          title={`Remove ${node.name}?`}
          description='Cosmos will stop monitoring this node and forget its saved token.'
          confirmLabel='Remove'
          onConfirm={() => removeNode(nodeId)}
        />
      </div>

      <NodeCredentialsDialog
        nodeId={nodeId}
        open={editingToken}
        onOpenChange={setEditingToken}
      />
    </div>
  );
}

export function SettingsPage() {
  const nodes = useNodeStore((s) => s.nodes);

  return (
    <>
      <PageHeader title='SETTINGS' />

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Server className='size-4' />
            Nodes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nodes.length === 0 ? (
            <p className='text-sm text-muted-foreground py-2'>
              No nodes configured yet.
            </p>
          ) : (
            nodes.map((n) => <NodeRow key={n.id} nodeId={n.id} />)
          )}
          <div className='pt-4'>
            <AddNode />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <MonitorCog className='size-4' />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className='flex items-center justify-between'>
          <div>
            <p className='text-sm'>Theme</p>
            <p className='text-xs text-muted-foreground'>
              Cosmos is designed for dark; light is supported.
            </p>
          </div>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Token storage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>
            {isTauri() ? (
              <>
                Agent tokens are stored in your operating system&rsquo;s keychain.
                Only a reference is kept in app data.
              </>
            ) : (
              <>
                This is the browser build, which has no keychain — tokens are kept
                in <code>localStorage</code> and are readable by any script running
                on this page. Use the desktop app for anything sensitive.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </>
  );
}

export default SettingsPage;

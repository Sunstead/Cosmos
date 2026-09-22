import { memo } from 'react';
import { useNodeMeta } from '@/api/queries';
import { NodeStatus } from '@/api/connection';
import { Dot, DotVariant } from './dot';
import { cn } from '@/lib/utils';

const DISPLAY: Record<NodeStatus, { label: string; dot: DotVariant; className: string }> = {
  connecting: { label: 'Connecting', dot: 'warning', className: 'text-warning' },
  online: { label: 'Online', dot: 'success', className: 'text-success' },
  offline: { label: 'Offline', dot: 'error', className: 'text-error' },
  // Distinct from offline on purpose: the fix is a token, not a reboot.
  unauthorized: { label: 'Sign in needed', dot: 'error', className: 'text-error' },
};

export const NodeStatusBadge = memo(function NodeStatusBadge({
  nodeId,
  showLabel = true,
  className,
}: {
  nodeId: string;
  showLabel?: boolean;
  className?: string;
}) {
  const meta = useNodeMeta(nodeId);
  const display = DISPLAY[meta?.status ?? 'connecting'];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', display.className, className)}
      title={meta?.error ?? display.label}
    >
      <Dot variant={display.dot} />
      {showLabel && display.label}
    </span>
  );
});

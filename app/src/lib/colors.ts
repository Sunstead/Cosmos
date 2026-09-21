import { DotVariant } from '@/components/dot';

/**
 * The one status vocabulary shared by dots, badges and text.
 */
export type StatusColor = 'default' | 'success' | 'warn' | 'error';

const TEXT_CLASS: Record<StatusColor, string> = {
  default: '',
  success: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
};

const DOT_VARIANT: Record<StatusColor, DotVariant> = {
  default: 'disabled',
  success: 'success',
  warn: 'warning',
  error: 'error',
};

export function getStatusColorClass(statusColor: StatusColor): string {
  return TEXT_CLASS[statusColor];
}

export function getStatusDotVariant(statusColor: StatusColor): DotVariant {
  return DOT_VARIANT[statusColor];
}

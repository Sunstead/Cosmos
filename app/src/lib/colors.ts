import { DotVariant } from '@/components/dot';

/**
 * One status vocabulary.
 *
 * There were three: `colors.ts` used `default | success | warn | error`,
 * `dot.tsx` used `success | warning | error | disabled`, and
 * `service-utils.ts` had its own map — with `error` meaning `text-destructive`
 * in one place and `bg-error` in another.
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

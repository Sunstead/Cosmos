export type StatusColor = 'default' | 'success' | 'warn' | 'error';

export function getStatusColorClass(statusColor: StatusColor): string {
  switch (statusColor) {
    case 'success':
      return 'text-success';
    case 'warn':
      return 'text-warning';
    case 'error':
      return 'text-destructive';
    case 'default':
    default:
      return '';
  }
}
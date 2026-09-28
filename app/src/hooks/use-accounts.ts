import { useMemo } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useNodeStore } from '@/stores/nodes';
import { Account, deriveAccounts } from '@/lib/accounts';

/**
 * Every provider the nodes use and your standing with each. Changes on
 * connection transitions and token refreshes, never per sample.
 */
export function useAccounts(): Account[] {
  const meta = useNodeStore((s) => s.meta);
  const sessions = useAuthStore((s) => s.sessions);
  return useMemo(() => deriveAccounts(meta, sessions), [meta, sessions]);
}

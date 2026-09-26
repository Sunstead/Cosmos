import { BackupDatabase } from '@/generated/BackupDatabase';

export type RestoreRepo = 'primary' | 'state';

export type RestoreTarget =
  | { kind: 'files'; path: string }
  | { kind: 'database'; database: BackupDatabase }
  | { kind: 'env' };

export interface RestoreStep {
  title: string;
  command?: string;
  note?: string;
  /** Set on a step that touches something live: what it does. */
  warning?: string;
}

/** Quotes a path for the shell only when it needs it. */
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Everything up to the last slash, for "copy it back into". */
function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const at = trimmed.lastIndexOf('/');
  return at <= 0 ? '/' : trimmed.slice(0, at);
}

/**
 * The commands to restore `target` from a snapshot, for the host's
 * `scripts/restore.sh`. Only the last steps change anything live, and they
 * say so. The state repository has its own snapshot IDs, so it uses `latest`.
 */
export function restoreSteps(
  snapshot: string,
  repo: RestoreRepo,
  target: RestoreTarget,
): RestoreStep[] {
  const snap = repo === 'state' ? 'latest' : snapshot;
  switch (target.kind) {
    case 'files': {
      const path = target.path.trim().replace(/\/+$/, '') || '/';
      return [
        {
          title: 'Restore into a new folder',
          command: `sudo scripts/restore.sh files ${repo} ${snap} ${shellQuote(path)}`,
          note: 'Nothing live is touched. It prints the folder it restored into.',
        },
        {
          title: 'Copy back what you need',
          command: `sudo cp -a <that folder>${shellQuote(path)} ${shellQuote(parentOf(path))}/`,
          note: 'Check the restored files first.',
          warning: 'Overwrites live files',
        },
      ];
    }
    case 'database': {
      const { name, used_by } = target.database;
      const services = used_by.map(shellQuote).join(' ');
      const steps: RestoreStep[] = [
        {
          title: 'Restore the dump',
          command: `sudo scripts/restore.sh dump ${repo} ${snap} ${shellQuote(name)}`,
          note: 'Nothing live is touched yet.',
        },
      ];
      if (services) {
        steps.push({
          title: 'Stop what uses it',
          command: `docker compose stop ${services}`,
          note: 'They stay down until the last step.',
          warning: 'Takes them offline',
        });
      }
      steps.push({
        title: 'Load it',
        command: `sudo scripts/restore.sh load ${shellQuote(name)}`,
        note: `Replaces what's in ${target.database.service} now. It asks you to type ${name} first.`,
        warning: 'Replaces live data',
      });
      if (services) {
        steps.push({
          title: 'Start them again',
          command: `docker compose start ${services}`,
        });
      }
      return steps;
    }
    case 'env':
      return [
        {
          title: 'Restore .env into a new folder',
          command: `sudo scripts/restore.sh env ${repo} ${snap}`,
          note: 'It prints a diff command to compare it with the live one. It holds secrets.',
        },
      ];
  }
}

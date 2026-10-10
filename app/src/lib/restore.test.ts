import { describe, expect, it } from 'vitest';
import { restoreSteps, shellQuote } from './restore';

const immich = {
  name: 'immich',
  service: 'immich-postgres',
  used_by: ['immich-server', 'immich-machine-learning'],
};

describe('restoreSteps', () => {
  it('restores files into a new folder before anything live changes', () => {
    const steps = restoreSteps('1a2b3c4d', 'primary', {
      kind: 'files',
      path: '/srv/storage/nextcloud/data/riley/files/Documents/',
    });
    expect(steps.map((s) => s.command)).toEqual([
      'sudo scripts/restore.sh files primary 1a2b3c4d /srv/storage/nextcloud/data/riley/files/Documents',
      'sudo cp -a <that folder>/srv/storage/nextcloud/data/riley/files/Documents /srv/storage/nextcloud/data/riley/files/',
    ]);
    expect(steps.map((s) => s.warning)).toEqual([undefined, 'Overwrites live files']);
  });

  it('stops, loads and restarts a database, flagging the live steps', () => {
    const steps = restoreSteps('1a2b3c4d', 'primary', {
      kind: 'database',
      database: immich,
    });
    expect(steps.map((s) => s.command)).toEqual([
      'sudo scripts/restore.sh dump primary 1a2b3c4d immich',
      'docker compose stop immich-server immich-machine-learning',
      'sudo scripts/restore.sh load immich',
      'docker compose start immich-server immich-machine-learning',
    ]);
    expect(steps.map((s) => s.warning)).toEqual([
      undefined,
      'Takes them offline',
      'Replaces live data',
      undefined,
    ]);
  });

  it('uses the newest snapshot from the state repository', () => {
    const [step] = restoreSteps('1a2b3c4d', 'state', { kind: 'env' });
    expect(step.command).toBe('sudo scripts/restore.sh env state latest');
  });

  it('quotes paths the shell would split', () => {
    expect(shellQuote('/srv/storage/My Files')).toBe("'/srv/storage/My Files'");
    expect(shellQuote("/it's")).toBe(`'/it'\\''s'`);
    expect(shellQuote('/srv/storage/ok')).toBe('/srv/storage/ok');
  });
});

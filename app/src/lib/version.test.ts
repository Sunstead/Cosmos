import { describe, expect, it } from 'vitest';
import { isNewer } from './version';

describe('isNewer', () => {
  it('orders by number, not by string', () => {
    expect(isNewer('0.13.0', '0.12.1')).toBe(true);
    expect(isNewer('0.10.0', '0.9.1')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.12.1', '0.13.0')).toBe(false);
  });

  it('says no to the same version', () => {
    expect(isNewer('0.12.1', '0.12.1')).toBe(false);
    expect(isNewer('v0.12.1', '0.12.1')).toBe(false);
  });

  it('puts a pre-release below its release', () => {
    expect(isNewer('0.13.0', '0.13.0-beta.1')).toBe(true);
    expect(isNewer('0.13.0-beta.1', '0.13.0')).toBe(false);
    expect(isNewer('0.13.0-beta.1', '0.12.1')).toBe(true);
    expect(isNewer('0.13.0-beta.10', '0.13.0-beta.2')).toBe(true);
    expect(isNewer('0.13.0-rc.1', '0.13.0-beta.2')).toBe(true);
    expect(isNewer('0.13.0-beta.1.1', '0.13.0-beta.1')).toBe(true);
  });

  it('says no when either side is not a version', () => {
    expect(isNewer('latest', '0.12.1')).toBe(false);
    expect(isNewer('0.13', '0.12.1')).toBe(false);
    expect(isNewer('0.13.0', '')).toBe(false);
  });
});

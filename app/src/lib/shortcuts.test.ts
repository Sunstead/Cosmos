import { describe, expect, it } from 'vitest';
import { chordKeys, chordLabel, isTypingTarget, matchesChord } from './shortcuts';
import { menuToCommand } from '@/components/command-host';

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key: k, ...mods });

describe('chord display', () => {
  it('uses symbols on mac and words elsewhere', () => {
    expect(chordKeys('mod+k', true)).toEqual(['⌘', 'K']);
    expect(chordKeys('mod+k', false)).toEqual(['Ctrl', 'K']);
    expect(chordLabel('mod+shift+l', true)).toBe('⌘⇧L');
    expect(chordLabel('mod+shift+l', false)).toBe('Ctrl+Shift+L');
  });
});

describe('matchesChord', () => {
  it('matches mod as meta on mac and ctrl elsewhere', () => {
    expect(matchesChord(key('k', { metaKey: true }), 'mod+k', true)).toBe(true);
    expect(matchesChord(key('k', { ctrlKey: true }), 'mod+k', true)).toBe(false);
    expect(matchesChord(key('k', { ctrlKey: true }), 'mod+k', false)).toBe(true);
    expect(matchesChord(key('k', { metaKey: true }), 'mod+k', false)).toBe(false);
  });

  it('requires modifiers to match exactly', () => {
    expect(matchesChord(key('k', { metaKey: true, shiftKey: true }), 'mod+k', true)).toBe(false);
    expect(matchesChord(key('L', { metaKey: true, shiftKey: true }), 'mod+shift+l', true)).toBe(true);
  });

  it('matches digits by code regardless of layout', () => {
    const e = new KeyboardEvent('keydown', { key: '&', code: 'Digit1', metaKey: true });
    expect(matchesChord(e, 'mod+1', true)).toBe(true);
  });
});

describe('isTypingTarget', () => {
  it('detects text fields', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('menuToCommand', () => {
  it('maps native menu ids to command ids', () => {
    expect(menuToCommand('view.command-palette')).toBe('palette');
    expect(menuToCommand('app.settings')).toBe('settings');
    expect(menuToCommand('go.logs')).toBe('go.logs');
  });
});

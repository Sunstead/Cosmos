import { describe, expect, it } from 'vitest';
import {
  chordKeys,
  chordLabel,
  isOverlayTarget,
  isTypingTarget,
  matchesChord,
  SequenceTracker,
  sequenceShortcuts,
  SHORTCUTS,
} from './shortcuts';
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

describe('sequences', () => {
  it('shows each step, joined by "then"', () => {
    expect(chordKeys('g o', true)).toEqual(['G', 'O']);
    expect(chordLabel('g o', false)).toBe('G then O');
  });

  it('are never matched as chords', () => {
    expect(matchesChord(key('o'), 'g o', false)).toBe(false);
  });

  it('complete on the second key and swallow both', () => {
    const t = new SequenceTracker({ 'go.overview': 'g o', 'go.logs': 'g l' });
    expect(t.press('g', 0)).toEqual({ id: null, consumed: true });
    expect(t.press('l', 100)).toEqual({ id: 'go.logs', consumed: true });
    // Finished: o on its own is nothing.
    expect(t.press('o', 200)).toEqual({ id: null, consumed: false });
  });

  it('start over after a pause or a dead end', () => {
    const t = new SequenceTracker({ 'go.overview': 'g o' }, 1_000);
    t.press('g', 0);
    expect(t.press('o', 2_000)).toEqual({ id: null, consumed: false });
    t.press('g', 3_000);
    expect(t.press('x', 3_100)).toEqual({ id: null, consumed: false });
    // A dead end on g still starts a new sequence.
    t.press('g', 4_000);
    expect(t.press('g', 4_100)).toEqual({ id: null, consumed: true });
    expect(t.press('o', 4_200)).toEqual({ id: 'go.overview', consumed: true });
  });

  it('give every page a distinct sequence', () => {
    const seqs = Object.values(sequenceShortcuts());
    expect(seqs.length).toBe(Object.keys(SHORTCUTS).filter((id) => id.startsWith('go.')).length);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe('isOverlayTarget', () => {
  it('spots focus inside a dialog or menu', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    expect(isOverlayTarget(button)).toBe(true);
    expect(isOverlayTarget(document.createElement('button'))).toBe(false);
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

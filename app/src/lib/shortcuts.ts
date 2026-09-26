import { usesMacKeys } from './platform';

/** A chord like `mod+k`, `mod+shift+l`, `/`. `mod` is ⌘ on Mac, Ctrl elsewhere. */
export type Chord = string;

export const SHORTCUTS = {
  palette: 'mod+k',
  sidebar: 'mod+b',
  settings: 'mod+,',
  theme: 'mod+shift+l',
  search: '/',
  'go.overview': 'mod+1',
  'go.nodes': 'mod+2',
  'go.services': 'mod+3',
  'go.containers': 'mod+4',
  'go.volumes': 'mod+5',
  'go.network': 'mod+6',
  'go.monitoring': 'mod+7',
  'go.logs': 'mod+8',
  'go.backups': 'mod+9',
  'go.events': 'mod+shift+e',
  'go.uptime': 'mod+shift+u',
} as const satisfies Record<string, Chord>;

export type ShortcutId = keyof typeof SHORTCUTS;

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
};

/** Key caps for display, e.g. `['⌘', 'K']` or `['Ctrl', 'K']`. */
export function chordKeys(chord: Chord, mac = usesMacKeys()): string[] {
  return chord.split('+').map((part) => {
    if (mac && MAC_SYMBOLS[part]) return MAC_SYMBOLS[part];
    if (part === 'mod') return 'Ctrl';
    if (part.length === 1) return part.toUpperCase();
    return part[0].toUpperCase() + part.slice(1);
  });
}

export function chordLabel(chord: Chord, mac = usesMacKeys()): string {
  return chordKeys(chord, mac).join(mac ? '' : '+');
}

/** Whether a keydown matches a chord. Modifiers must match exactly. */
export function matchesChord(e: KeyboardEvent, chord: Chord, mac = usesMacKeys()): boolean {
  const parts = chord.split('+');
  const key = parts[parts.length - 1];
  const wants = new Set(parts.slice(0, -1));

  const mod = mac ? e.metaKey : e.ctrlKey;
  if (wants.has('mod') !== mod) return false;
  if (wants.has('shift') !== e.shiftKey) return false;
  if (wants.has('alt') !== e.altKey) return false;
  // The non-mod key of the other platform must not be held.
  if (mac ? e.ctrlKey : e.metaKey) return false;

  return e.key.toLowerCase() === key || e.code === `Digit${key}`;
}

/** True when focus is in a text field, where bare-key shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

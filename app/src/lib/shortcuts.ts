import { usesMacKeys } from './platform';

/**
 * A chord like `mod+k`, `mod+shift+l`, `/`, where `mod` is ⌘ on Mac and Ctrl
 * elsewhere; or a sequence of bare keys separated by spaces, like `g o`.
 */
export type Chord = string;

/**
 * Pages are "G then a letter", as in Linear and GitHub: a dozen pages don't
 * fit on number keys anyone remembers, and bare keys work the same on every
 * platform. Updates is P (its icon is a package) because Uptime has U.
 */
export const SHORTCUTS = {
  palette: 'mod+k',
  sidebar: 'mod+b',
  settings: 'mod+,',
  search: '/',
  'go.overview': 'g o',
  'go.nodes': 'g n',
  'go.services': 'g s',
  'go.containers': 'g c',
  'go.volumes': 'g v',
  'go.network': 'g t',
  'go.monitoring': 'g m',
  'go.uptime': 'g u',
  'go.logs': 'g l',
  'go.events': 'g e',
  'go.updates': 'g p',
  'go.backups': 'g b',
} as const satisfies Record<string, Chord>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** How long the next key of a sequence may take. */
export const SEQUENCE_TIMEOUT_MS = 1_500;

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
};

export function isSequence(chord: Chord): boolean {
  return chord.includes(' ');
}

function keyCap(part: string, mac: boolean): string {
  if (mac && MAC_SYMBOLS[part]) return MAC_SYMBOLS[part];
  if (part === 'mod') return 'Ctrl';
  if (part.length === 1) return part.toUpperCase();
  return part[0].toUpperCase() + part.slice(1);
}

/**
 * Key caps for display: `['⌘', 'K']` or `['Ctrl', 'K']` for a chord, one cap
 * per step for a sequence (`['G', 'O']`).
 */
export function chordKeys(chord: Chord, mac = usesMacKeys()): string[] {
  if (isSequence(chord)) return chord.split(' ').map((k) => keyCap(k, mac));
  return chord.split('+').map((part) => keyCap(part, mac));
}

export function chordLabel(chord: Chord, mac = usesMacKeys()): string {
  if (isSequence(chord)) return chordKeys(chord, mac).join(' then ');
  return chordKeys(chord, mac).join(mac ? '' : '+');
}

/** Whether a keydown matches a chord. Modifiers must match exactly. */
export function matchesChord(e: KeyboardEvent, chord: Chord, mac = usesMacKeys()): boolean {
  if (isSequence(chord)) return false;
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

/**
 * Follows key sequences as bare keys arrive. `press` says whether the key
 * belonged to one (so the caller can stop it doing anything else) and which
 * shortcut, if any, it completed. A pause longer than the timeout starts over.
 */
export class SequenceTracker {
  private keys: string[] = [];
  private last = 0;

  constructor(
    private readonly sequences: Record<string, Chord>,
    private readonly timeoutMs = SEQUENCE_TIMEOUT_MS,
  ) {}

  press(key: string, now = Date.now()): { id: string | null; consumed: boolean } {
    if (now - this.last > this.timeoutMs) this.keys = [];
    this.last = now;
    const keys = [...this.keys, key.toLowerCase()];
    const typed = keys.join(' ');

    for (const [id, seq] of Object.entries(this.sequences)) {
      if (seq === typed) {
        this.keys = [];
        return { id, consumed: true };
      }
    }
    if (Object.values(this.sequences).some((seq) => seq.startsWith(`${typed} `))) {
      this.keys = keys;
      return { id: null, consumed: true };
    }
    // A dead end. The key may still start a sequence of its own.
    this.keys = [];
    return keys.length > 1 ? this.press(key, now) : { id: null, consumed: false };
  }

  reset() {
    this.keys = [];
  }
}

/** The shortcuts that are sequences, for a `SequenceTracker`. */
export function sequenceShortcuts(): Record<string, Chord> {
  return Object.fromEntries(Object.entries(SHORTCUTS).filter(([, chord]) => isSequence(chord)));
}

/** True when focus is in a text field, where bare-key shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.isContentEditable;
}

/** True inside an open dialog or menu, where page shortcuts would act behind it. */
export function isOverlayTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
  );
}

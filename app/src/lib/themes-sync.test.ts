import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, normalizeChoice, normalizeSlot, storageKeys, THEMES, themeById } from '@sunstead/ui/themes';
import { THEME_ALIASES } from './theme-aliases';

// The themes themselves are tested in @sunstead/ui; this keeps Cosmos's own
// copies (index.html's first paint, the aliases) in step with them.
const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

describe('themes', () => {
  it('index.html paints the same themes before any script', () => {
    const map = /var themes = \{([^}]*)\}/.exec(html)?.[1] ?? '';
    const entries = [...map.matchAll(/'?([\w-]+)'?:\s*'(dark|light) (rounded|tech)'/g)].map((m) => [m[1], `${m[2]} ${m[3]}`]);
    expect(entries).toEqual(THEMES.map((t) => [t.id, `${t.scheme} ${t.style}`]));
    expect(html).toContain(`data-theme="${DEFAULT_THEME}" data-style="${themeById(DEFAULT_THEME)!.style}"`);
    const keys = storageKeys('cosmos');
    expect(html).toContain(`localStorage.getItem('${keys.theme}')`);
    expect(html).toContain(`'${keys.theme}-' + s`);
  });

  it('index.html maps the same old values', () => {
    const map = /var aliases = \{([^}]*)\}/.exec(html)?.[1] ?? '';
    const entries = Object.fromEntries([...map.matchAll(/'?([\w-]+)'?:\s*'([\w-]+)'/g)].map((m) => [m[1], m[2]]));
    expect(entries).toEqual(THEME_ALIASES);
  });

  it('keeps old stored values working', () => {
    expect(normalizeChoice('cosmos-dark', THEME_ALIASES)).toBe('sunstead-dark');
    expect(normalizeChoice('light', THEME_ALIASES)).toBe('sunstead-light');
    expect(normalizeSlot('light', 'cosmos-light', THEME_ALIASES)).toBe('sunstead-light');
    expect(normalizeChoice('nebula', THEME_ALIASES)).toBe('nebula');
  });
});

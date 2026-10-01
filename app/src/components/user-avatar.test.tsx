import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { UserAvatar } from './user-avatar';

/**
 * jsdom never loads images, so stand in for the off-screen `Image` Radix
 * loads the picture with: URLs containing "ok" load, anything else fails.
 */
class FakeImage extends EventTarget {
  complete = false;
  naturalWidth = 0;
  referrerPolicy = '';
  crossOrigin: string | null = null;
  #src = '';
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    setTimeout(() => {
      this.complete = true;
      if (value.includes('ok')) {
        this.naturalWidth = 64;
        this.dispatchEvent(new Event('load'));
      } else {
        this.dispatchEvent(new Event('error'));
      }
    }, 10);
  }
}

const pat = { name: 'Pat Doe', known: true };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Every <img> that ever appears, so a flash between renders still counts. */
function watchImages(root: HTMLElement): string[] {
  const seen: string[] = [];
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof HTMLElement) {
          if (n.tagName === 'IMG') seen.push(n.getAttribute('src') ?? '');
          n.querySelectorAll('img').forEach((img) => seen.push(img.getAttribute('src') ?? ''));
        }
      });
    }
  }).observe(root, { childList: true, subtree: true });
  return seen;
}

describe('UserAvatar', () => {
  it('shows initials until the picture has loaded, then the picture', async () => {
    const { container } = render(<UserAvatar who={{ ...pat, picture: 'https://auth.example/avatars/ok.png' }} />);
    expect(screen.getByText('PD')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://auth.example/avatars/ok.png');
    expect(screen.queryByText('PD')).toBeNull();
  });

  it('keeps the initials, and never renders a broken image, when the picture fails', async () => {
    const container = document.body.appendChild(document.createElement('div'));
    const seen = watchImages(container);
    render(<UserAvatar who={{ ...pat, picture: 'https://auth.example/avatars/gone.png' }} />, { container });

    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(screen.getByText('PD')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(seen).toEqual([]);
  });

  it('puts initials on a neutral disc, not the primary colour', () => {
    render(<UserAvatar who={{ ...pat, picture: null }} />);
    const fallback = screen.getByText('PD');
    expect(fallback).toHaveClass('bg-sidebar-accent', 'text-sidebar-accent-foreground');
    expect(fallback.className).not.toMatch(/sidebar-primary/);
  });

  it('shows a person, not initials, for nobody in particular', () => {
    const { container } = render(<UserAvatar who={{ name: 'Guest', picture: null, known: false }} />);
    expect(screen.queryByText('G')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

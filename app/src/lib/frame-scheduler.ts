/**
 * Coalesces imperative DOM updates into one animation frame. Callbacks dedupe
 * by identity, and nothing runs while the page is hidden.
 */

const pending = new Set<() => void>();
let frame: number | null = null;

function flush() {
  frame = null;
  // Snapshot first: a callback that schedules another draw must land in the
  // next frame, not recurse into this one.
  const work = [...pending];
  pending.clear();
  for (const fn of work) {
    try {
      fn();
    } catch {
      // One bad chart must not stop the rest of the frame.
    }
  }
}

export function requestDraw(fn: () => void) {
  pending.add(fn);
  if (frame === null) frame = requestAnimationFrame(flush);
}

export function cancelDraw(fn: () => void) {
  pending.delete(fn);
}

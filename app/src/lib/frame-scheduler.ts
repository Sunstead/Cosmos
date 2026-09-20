/**
 * Coalesces imperative DOM updates into a single animation frame.
 *
 * Several sparklines and readouts on one card all want to update when a
 * sample arrives. Without this, each would touch the DOM independently and
 * force its own style recalculation; with it, they all land in one frame.
 *
 * Callbacks are deduplicated by identity, so a component re-requesting before
 * the frame runs is free. `requestAnimationFrame` also stops firing when the
 * page is hidden, which is exactly the behaviour we want — nothing repaints
 * while nobody is looking.
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

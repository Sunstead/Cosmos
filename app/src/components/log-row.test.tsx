import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { LogRow } from './log-row';
import { LogLine } from '@/generated/LogLine';
import { prepareLine } from '@/lib/log-view';

const line = (partial: Partial<LogLine>) => prepareLine({ stream: 'stdout', ts: null, text: '', ...partial });

describe('LogRow', () => {
  const saved = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Asia/Tokyo';
  });
  afterEach(() => {
    process.env.TZ = saved;
  });

  it('does not colour a healthy stderr line as an error', () => {
    const { container } = render(<LogRow line={line({ stream: 'stderr', text: '[notice] 1#1: start worker process 29' })} />);
    const row = container.firstElementChild!;
    expect(row.className).not.toMatch(/text-error/);
    expect(row.getAttribute('data-stream')).toBe('stderr');
  });

  it('colours the lines that say they are errors or warnings, on either stream', () => {
    const err = render(<LogRow line={line({ text: 'ERROR connection refused' })} />).container.firstElementChild!;
    const warn = render(<LogRow line={line({ stream: 'stderr', text: 'level=warn msg=slow' })} />).container.firstElementChild!;
    expect(err.className).toMatch(/text-error/);
    expect(warn.className).toMatch(/text-warning/);
  });

  it('shows the time in the local zone, with the full stamp on hover', () => {
    // 01:02:03 UTC is 10:02:03 in Tokyo.
    const { getByTitle } = render(<LogRow line={line({ ts: '2020-01-02T01:02:03.456789Z', text: 'x' })} />);
    const stamp = getByTitle(/2020/);
    expect(stamp.textContent).toMatch(/10:02:03/);
    expect(stamp.textContent).not.toMatch(/01:02:03/);
  });

  it('tags the container in the all-containers view', () => {
    const { getByText } = render(<LogRow line={line({ text: 'hello', container: 'abc' })} container='web' />);
    expect(getByText('web').style.color).toMatch(/var\(--ansi-\d+\)/);
  });

  describe('a JSON line', () => {
    const json = line({ text: '{"level":"error","msg":"disk full","path":"/srv","pid":7}' });

    it('reads as its message and fields, coloured by its own level', () => {
      const { container } = render(<LogRow line={json} />);
      const row = container.firstElementChild!;
      expect(row.textContent).toContain('disk full');
      expect(row.textContent).toContain('path=/srv');
      expect(row.textContent).not.toContain('"msg"');
      expect(row.className).toMatch(/text-error/);
    });

    it('opens to every field from its chevron', () => {
      const onToggle = vi.fn();
      const closed = render(<LogRow line={json} onToggle={onToggle} />);
      fireEvent.click(closed.getByRole('button', { name: 'Show fields' }));
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(json.id);

      const open = render(<LogRow line={json} onToggle={onToggle} expanded />);
      expect(open.container.querySelector('pre')!.textContent).toContain('"pid": 7');
    });
  });
});

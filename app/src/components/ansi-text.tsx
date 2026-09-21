import { CSSProperties, memo } from 'react';
import { AnsiStyle, parseAnsi } from '@/lib/ansi';

function css(s: AnsiStyle): CSSProperties | undefined {
  if (!s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline) return undefined;
  return {
    color: s.fg,
    backgroundColor: s.bg,
    fontWeight: s.bold ? 600 : undefined,
    opacity: s.dim ? 0.65 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: s.underline ? 'underline' : undefined,
  };
}

/** A log line with its ANSI colours rendered through theme tokens. */
export const AnsiText = memo(function AnsiText({ text }: { text: string }) {
  return (
    <>
      {parseAnsi(text).map((seg, i) => {
        const style = css(seg.style);
        return style ? (
          <span key={i} style={style}>
            {seg.text}
          </span>
        ) : (
          seg.text
        );
      })}
    </>
  );
});

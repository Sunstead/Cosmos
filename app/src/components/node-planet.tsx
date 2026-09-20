import { memo, useId, useState } from 'react';
import { planetStyle } from '@/lib/planet';
import { cn } from '@/lib/utils';

interface Props {
  name: string;
  className?: string;
  /** Dims the planet for a node that isn't reporting. */
  dimmed?: boolean;
}

/**
 * A node, drawn as a planet.
 *
 * Uses `/public/<name>.png` when one exists — Jupiter has a real image — and
 * otherwise generates a deterministic one from the node's name, so a new node
 * looks distinct immediately without anyone having to supply artwork.
 */
export const NodePlanet = memo(function NodePlanet({ name, className, dimmed }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const id = useId();
  const style = planetStyle(name);

  if (!imageFailed) {
    return (
      <img
        src={`/${name}.png`}
        alt=''
        aria-hidden='true'
        // The fallback is the normal case, not an error path: most nodes will
        // never have a bundled image.
        onError={() => setImageFailed(true)}
        className={cn(
          'object-contain drop-shadow-xl drop-shadow-black/50',
          dimmed && 'opacity-40 saturate-0',
          className,
        )}
      />
    );
  }

  const base = `hsl(${style.hue} ${style.saturation}% 52%)`;
  const dark = `hsl(${style.hue} ${style.saturation}% 16%)`;
  const accent = `hsl(${style.accentHue} ${style.saturation}% 62%)`;

  return (
    <svg
      viewBox='0 0 100 100'
      className={cn(
        'overflow-visible drop-shadow-xl drop-shadow-black/50',
        dimmed && 'opacity-40 saturate-0',
        className,
      )}
      aria-hidden='true'
    >
      <defs>
        {/* Off-centre so the sphere reads as lit from the upper left. */}
        <radialGradient id={`${id}-body`} cx='35%' cy='30%' r='75%'>
          <stop offset='0%' stopColor={base} />
          <stop offset='55%' stopColor={base} />
          <stop offset='100%' stopColor={dark} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx='50' cy='50' r='34' />
        </clipPath>
      </defs>

      {style.ring && (
        <ellipse
          cx='50'
          cy='50'
          rx='48'
          ry='13'
          fill='none'
          stroke={accent}
          strokeWidth='3'
          opacity='0.45'
          transform={`rotate(${style.ringTilt} 50 50)`}
        />
      )}

      <circle cx='50' cy='50' r='34' fill={`url(#${id}-body)`} />

      <g clipPath={`url(#${id}-clip)`}>
        {style.bands.map((band, i) => (
          <rect
            key={i}
            x='16'
            y={band.y}
            width='68'
            height={band.height}
            fill={i % 2 === 0 ? accent : dark}
            opacity={band.opacity}
          />
        ))}
      </g>

      {/* Rim light along the terminator. */}
      <circle
        cx='50'
        cy='50'
        r='34'
        fill='none'
        stroke={accent}
        strokeWidth='0.8'
        opacity='0.35'
      />
    </svg>
  );
});

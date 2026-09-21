import { memo, useEffect, useRef } from 'react';
import { planetExtent, planetStyle } from '@/lib/planet';
import { planetSprite } from '@/lib/planet-render';
import { onThemeChange } from '@/lib/theme-tokens';
import { cn } from '@/lib/utils';
import { useNodeName, useNodeStore } from '@/stores/nodes';

/**
 * A node drawn as a planet. Same renderer as the constellation, so a node
 * looks identical everywhere. Redraws only on size or theme change.
 */
export const NodePlanet = memo(function NodePlanet({
  name,
  size,
  dimmed,
  className,
}: {
  name: string;
  /** Box size in CSS pixels. */
  size: number;
  dimmed?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);

      // Fit the whole drawing, rings included, inside the box.
      const r = size / 2 / planetExtent(planetStyle(name));
      const sprite = planetSprite(name, r, dpr);
      const px = sprite.size * dpr;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sprite.canvas, (canvas.width - px) / 2, (canvas.height - px) / 2, px, px);
    };

    draw();
    // Observes the <html> class itself, so tokens are read after the switch.
    return onThemeChange(draw);
  }, [name, size]);

  return (
    <canvas
      ref={ref}
      aria-hidden='true'
      style={{ width: size, height: size }}
      className={cn('shrink-0 transition-[opacity,filter]', dimmed && 'opacity-40 grayscale', className)}
    />
  );
});

/** A node's planet, keyed by its display name. */
export const NodeAvatar = memo(function NodeAvatar({
  nodeId,
  size,
  className,
}: {
  nodeId: string;
  size: number;
  className?: string;
}) {
  const name = useNodeName(nodeId);
  const online = useNodeStore((s) => s.meta[nodeId]?.status === 'online');
  return <NodePlanet name={name ?? nodeId} size={size} dimmed={!online} className={className} />;
});

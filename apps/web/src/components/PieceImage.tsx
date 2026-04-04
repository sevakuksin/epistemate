import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type PieceImageProps = {
  src?: string;
  className?: string;
  style?: CSSProperties;
  alt?: string;
};

function fallbackSrc(src: string): string | null {
  if (src.endsWith(".svg")) return `${src.slice(0, -4)}.png`;
  if (src.endsWith(".png")) return `${src.slice(0, -4)}.svg`;
  return null;
}

export function PieceImage({ src, className, style, alt = "piece" }: PieceImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setTriedFallback(false);
  }, [src]);

  const nextSrc = useMemo(() => (currentSrc ? fallbackSrc(currentSrc) : null), [currentSrc]);

  if (!currentSrc) return null;

  return (
    <img
      className={className}
      style={style}
      src={currentSrc}
      alt={alt}
      onError={() => {
        if (triedFallback || !nextSrc) return;
        setTriedFallback(true);
        setCurrentSrc(nextSrc);
      }}
    />
  );
}

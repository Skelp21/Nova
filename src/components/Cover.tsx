import { Music2 } from "lucide-react";
import { useState } from "react";

export function Cover({ src, size, radius = 6, className = "" }: { src?: string | null; size: number; radius?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, borderRadius: radius, minWidth: size };
  if (!src || broken)
    return (
      <div className={`cover cover-empty ${className}`} style={style}>
        <Music2 size={Math.max(14, size * 0.38)} />
      </div>
    );
  return (
    <img
      className={`cover ${className}`}
      style={style}
      src={src}
      loading="lazy"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

/** 2x2 mosaic of the first covers, for playlists. */
export function Mosaic({ covers, size }: { covers: (string | null | undefined)[]; size: number }) {
  const list = covers.filter(Boolean).slice(0, 4) as string[];
  if (list.length < 4) return <Cover src={list[0]} size={size} radius={8} />;
  return (
    <div className="mosaic" style={{ width: size, height: size, minWidth: size }}>
      {list.map((c, i) => (
        <img key={i} src={c} draggable={false} referrerPolicy="no-referrer" />
      ))}
    </div>
  );
}

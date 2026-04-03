export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Unit direction of a move (for stateful rules). */
export function normalizeDirection(dx: number, dy: number): { dx: number; dy: number } | null {
  if (dx === 0 && dy === 0) return null;
  if (dx === 0) return { dx: 0, dy: dy > 0 ? 1 : -1 };
  if (dy === 0) return { dx: dx > 0 ? 1 : -1, dy: 0 };
  const g = gcd(dx, dy);
  return { dx: dx / g, dy: dy / g };
}

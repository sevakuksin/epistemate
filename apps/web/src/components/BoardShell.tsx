import type { CSSProperties, ReactNode } from "react";

type BoardShellProps = {
  cols: number;
  rows: number;
  children: ReactNode;
  className?: string;
};

/**
 * Wraps the board grid so `--cell` scales down on narrow viewports.
 * Cell size uses vw (not cqw) so flex layouts cannot collapse the board to 0 width.
 */
export function BoardShell({ cols, rows, children, className = "" }: BoardShellProps) {
  const gridVars = {
    ["--board-cols" as string]: cols,
    ["--board-rows" as string]: rows,
  } as CSSProperties;

  return (
    <div className={`board-wrap ${className}`.trim()} style={gridVars}>
      <div
        className="board board-fluid"
        style={
          {
            ...gridVars,
            gridTemplateColumns: `repeat(${cols}, var(--cell))`,
            gridTemplateRows: `repeat(${rows}, var(--cell))`,
            width: "calc(var(--board-cols) * var(--cell))",
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

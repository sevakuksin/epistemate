import type { CSSProperties, ReactNode } from "react";

type BoardShellProps = {
  cols: number;
  rows: number;
  children: ReactNode;
  className?: string;
};

/**
 * Wraps the board grid so `--cell` scales down on narrow viewports (container query).
 * Pass grid cells as children (typically square buttons).
 */
export function BoardShell({ cols, rows, children, className = "" }: BoardShellProps) {
  return (
    <div className={`board-wrap ${className}`.trim()}>
      <div
        className="board board-fluid"
        style={
          {
            ["--board-cols" as string]: cols,
            ["--board-rows" as string]: rows,
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

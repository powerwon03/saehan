import type { SkillGrid } from '@/server/admin/skillGrid';

// Pure helpers for the 숙련도 표 (no React).

export type Cell = SkillGrid['cells'][number];
export type Level = Cell['level'];

/**
 * Value to POST when a cell is clicked: manual 0 → 1 → 2 → 3 → null (back to 이력 기준) → manual 0.
 * A history-based cell (or a missing one) starts at manual 0 whatever level it shows.
 */
export function nextLevel(cell: Pick<Cell, 'level' | 'manual'> | undefined): Level | null {
  if (!cell?.manual) return 0;
  return cell.level === 3 ? null : ((cell.level + 1) as Level);
}

/** Lookup of a grid's cells by person and post. */
export function cellIndex(cells: Cell[]): (personId: string, postId: string) => Cell | undefined {
  const map = new Map(cells.map((c) => [`${c.personId}:${c.postId}`, c]));
  return (personId, postId) => map.get(`${personId}:${postId}`);
}

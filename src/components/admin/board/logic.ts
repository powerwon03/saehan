import type { BoardView } from '@/server/views/boardView';

// Pure helpers for the board screen (no React).

/**
 * One POST /api/admin/board action without its slot fields (date/shift/factoryId are added by the caller).
 * The route keeps its zod union private, so the client only fixes the `type` tag.
 */
export type BoardAction = { type: string } & Record<string, unknown>;

type Plan = BoardView['lines'][number]['plan'];

export type Placement = { assignmentId: string; postId: string; postCode: string; postName: string };

/** Where `personId` sits on this board (same factory, date and shift), or null. */
export function placementOf(view: Pick<BoardView, 'lines'>, personId: string): Placement | null {
  for (const l of view.lines) {
    const p = l.people.find((x) => x.personId === personId);
    if (p) return { assignmentId: p.assignmentId, postId: l.post.id, postCode: l.post.code, postName: l.post.name };
  }
  return null;
}

/**
 * 「다른 사람으로 바꾸기」: someone on another post of this board → swap the two assignments; someone not on the
 * board → place them on the chip's post, then take the chip's person off. Same post / same person → nothing.
 */
export function replaceActions(
  view: Pick<BoardView, 'lines'>,
  chip: { assignmentId: string; personId: string; postId: string },
  pickedId: string,
): BoardAction[] {
  if (pickedId === chip.personId) return [];
  const other = placementOf(view, pickedId);
  if (other) return other.postId === chip.postId ? [] : [{ type: 'swap', assignmentIdA: chip.assignmentId, assignmentIdB: other.assignmentId }];
  return [
    { type: 'assign', postId: chip.postId, personId: pickedId },
    { type: 'unassign', assignmentId: chip.assignmentId },
  ];
}

/** Product dropdown value: a product id, '' (running, no product), 'off' (쉼) or 'unmanned' (무인). */
export function planValue(plan: Plan): string {
  return plan.status === 'run' ? (plan.productId ?? '') : plan.status;
}

export function planFromValue(value: string): Plan {
  if (value === 'off' || value === 'unmanned') return { productId: null, status: value };
  return { productId: value === '' ? null : value, status: 'run' };
}

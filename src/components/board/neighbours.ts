/** Anything placed in a board column: Kibo's items are one flat array in display order. */
export type Positioned = { id: string; column: string };

const PREFIX = 'status:';

// Column droppable ids keep the status: prefix — board.spec.ts waits for dnd-kit to
// announce "droppable area status:…" (spec §10 A3).
export const columnId = (statusId: string) => `${PREFIX}${statusId}`;
export const statusIdOf = (column: string) => column.slice(PREFIX.length);

/** Where `taskId` sits after a drag, in the shape moveTaskAction needs. */
export function neighboursAfterMove<T extends Positioned>(items: T[], taskId: string) {
  const moved = items.find((i) => i.id === taskId);
  if (!moved) return null;

  const column = items.filter((i) => i.column === moved.column);
  const index = column.findIndex((i) => i.id === taskId);

  return {
    statusId: statusIdOf(moved.column),
    // Neighbour ids, never a position: the server computes the key so two
    // concurrent drags cannot land on the same one (v1 spec §6.4).
    beforeId: column[index - 1]?.id ?? null,
    afterId: column[index + 1]?.id ?? null,
    index,
    columnSize: column.length,
  };
}

/** True when the card is in the same column between the same neighbours. */
export function isUnchanged<T extends Positioned>(before: T[], after: T[], taskId: string) {
  const a = neighboursAfterMove(before, taskId);
  const b = neighboursAfterMove(after, taskId);
  return !!a && !!b && a.statusId === b.statusId && a.beforeId === b.beforeId && a.afterId === b.afterId;
}

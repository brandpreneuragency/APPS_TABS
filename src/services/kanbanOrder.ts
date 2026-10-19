interface OrderedCard {
  id: string;
  order?: number;
}

export function sortKanbanCards<T extends OrderedCard>(cards: readonly T[]): T[] {
  return cards.map((card, index) => ({ card, order: card.order ?? index }))
    .sort((left, right) => left.order - right.order || left.card.id.localeCompare(right.card.id))
    .map(({ card }) => card);
}

export function insertKanbanCard<T extends OrderedCard>(cards: readonly T[], moved: T, beforeId: string | null): (T & { order: number })[] {
  const ordered = sortKanbanCards(cards).filter((card) => card.id !== moved.id);
  const index = beforeId === null ? -1 : ordered.findIndex((card) => card.id === beforeId);
  ordered.splice(index < 0 ? ordered.length : index, 0, moved);
  return ordered.map((card, order) => ({ ...card, order }));
}

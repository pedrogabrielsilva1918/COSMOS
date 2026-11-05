export const REQUEST_ORDERS = Object.freeze(['recent', 'oldest', 'priority', 'deadline']);
const priorityRank = { normal: 0, alta: 1, urgente: 2 };
const byPriority = (a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);

export function orderRequests(requests, order = 'recent') {
  if (!REQUEST_ORDERS.includes(order)) throw new TypeError('Ordenação inválida.');
  return [...requests].sort((a, b) => {
    if (order === 'recent') return b.id - a.id;
    if (order === 'oldest') return a.id - b.id;
    if (order === 'priority') return byPriority(a, b) || a.id - b.id;
    if (Boolean(a.due_date) !== Boolean(b.due_date)) return a.due_date ? -1 : 1;
    if (a.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    return byPriority(a, b) || a.id - b.id;
  });
}

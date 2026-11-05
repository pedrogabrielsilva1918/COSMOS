export function summarizeSectors(sectors, requests) {
  const summaries = new Map(sectors.map(sector => [sector.id, { id: sector.id, name: sector.name, active: sector.active, total: 0, pending: 0, overdue: 0, urgent: 0 }]));
  for (const request of requests) {
    const summary = summaries.get(request.sector_id);
    if (!summary) continue;
    summary.total++;
    if (request.status === 'pendente') {
      summary.pending++;
      if (request.is_overdue) summary.overdue++;
      if (request.priority === 'urgente') summary.urgent++;
    }
  }
  return [...summaries.values()].filter(sector => sector.total > 0).sort((a, b) => b.pending - a.pending || b.overdue - a.overdue || b.urgent - a.urgent || a.name.localeCompare(b.name, 'pt-BR') || a.id - b.id);
}

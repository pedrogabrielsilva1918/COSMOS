const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

export function filterSectors(sectors, { query = '', status = '' } = {}) {
  if (!['', 'active', 'inactive'].includes(status)) throw new TypeError('Filtro de setor inválido.');
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return sectors.filter(sector => {
    if (status === 'active' && !sector.active) return false;
    if (status === 'inactive' && sector.active) return false;
    const text = normalizeSearch(`${sector.name} ${sector.description || ''}`);
    return terms.every(term => text.includes(term));
  });
}

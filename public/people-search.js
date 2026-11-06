const normalizeSearch = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

export function filterPeople(people, { query = '', role = '', access = '', sectorId = '' } = {}) {
  if (!['', 'admin', 'colaborador'].includes(role)) throw new TypeError('Filtro de perfil inválido.');
  if (!['', 'active', 'inactive'].includes(access)) throw new TypeError('Filtro de acesso inválido.');
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return people.filter(person => {
    if (role && person.role !== role) return false;
    if (access === 'active' && !person.active) return false;
    if (access === 'inactive' && person.active) return false;
    if (sectorId !== '' && String(person.sector_id) !== String(sectorId)) return false;
    const text = normalizeSearch(`${person.name} ${person.email} ${person.sector || ''}`);
    return terms.every(term => text.includes(term));
  });
}

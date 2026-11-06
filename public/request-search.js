const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

// Recebe apenas pedidos já autorizados pelo workspace ou pela consulta do servidor.
export function matchesRequestSearch(request, query = '') {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const text = [request.title, request.description, request.author, request.sector, `COS-${String(request.id).padStart(5, '0')}`].map(normalize).join(' ');
  return terms.every(term => text.includes(term));
}

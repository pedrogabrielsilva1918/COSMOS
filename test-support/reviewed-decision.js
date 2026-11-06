// Simula o cliente carregando o conteúdo que está prestes a analisar.
// Testes de concorrência passam expected explicitamente para manter a versão antiga.
export async function reviewedDecision(base, path, body, cookie = '') {
  if (!/^\/api\/requests\/\d+\/decision$/.test(path) || !body || body.expected !== undefined) return body;
  const response = await fetch(base+'/api/workspace',{headers:{cookie}});
  if (!response.ok) return body;
  const workspace = await response.json(), id = Number(path.split('/')[3]);
  const request = workspace.requests.find(r=>r.id===id);
  return request ? {...body,expected:{title:request.title,description:request.description}} : body;
}

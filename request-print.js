const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const labels = { pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
const dateTime = value => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Não registrada';
const day = value => value ? value.split('-').reverse().join('/') : 'Sem prazo';

export function renderRequestPrint({ request, organization, generatedAt = new Date() }) {
  const r = request, e = escapeHTML;
  const protocol = `COS-${String(r.id).padStart(5, '0')}`;
  const detail = (label, value) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${protocol} · COSMOS</title><link rel="stylesheet" href="/print.css"><script src="/print.js" defer></script></head>
<body><div class="print-tools"><p>Use a opção <strong>Salvar como PDF</strong> no destino da impressão para guardar uma cópia.</p><button type="button" id="print-document">Imprimir / salvar PDF</button></div>
<main><header><span class="brand">COSMOS</span><p>${e(organization.name)}<br>${organization.type === 'publica' ? 'Organização pública' : 'Empresa privada'}</p></header>
<div class="document-heading"><p class="eyebrow">RESUMO DA SOLICITAÇÃO</p><h1>${protocol}</h1><p class="status">${e(labels[r.status] || r.status)}</p></div>
<h2>${e(r.title)}</h2><dl class="details">${detail('Solicitante', r.author)}${detail('Setor responsável', r.sector)}${detail('Prioridade', labels[r.priority] || r.priority)}${detail('Enviada em · Brasília', dateTime(r.created_at))}${detail('Prazo', day(r.due_date))}${detail('Responsável pela análise', r.assignee_name ? r.assignee_name + (r.assignee_available ? '' : ' (indisponível)') : 'Não definido')}</dl>
<section><h3>Descrição e justificativa</h3><p class="long-text">${e(r.description)}</p></section>
<section class="decision"><h3>Decisão</h3>${r.status === 'pendente' ? '<p>Aguardando análise.</p>' : `<dl class="details">${detail('Situação', labels[r.status] || r.status)}${detail('Avaliada por', r.reviewer || 'Não registrado')}${detail('Decidida em · Brasília', dateTime(r.decided_at))}</dl><p class="long-text">${e(r.decision)}</p>`}</section>
<footer><p>Gerado em ${e(dateTime(generatedAt))} (Brasília).</p><p>Retrato dos dados no momento da geração. Consulte o COSMOS para acompanhar atualizações. Este resumo não possui assinatura digital.</p></footer></main></body></html>`;
}

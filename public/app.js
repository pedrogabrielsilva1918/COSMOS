'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const statusName = { pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada' };
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const formatDeadline = value => value ? String(value).split('-').reverse().join('/') : 'Sem prazo';
const deadlineBadge = request => `<span class="deadline-label ${request.is_overdue ? 'deadline-late' : ''}">${escapeHTML(formatDeadline(request.due_date))}${request.is_overdue ? '<small>Prazo vencido</small>' : ''}</span>`;
const assigneeBadge = request => `<span class="request-assignee">${escapeHTML(request.assignee_name || 'Não definido')}${request.status === 'pendente' && request.assigned_to && !request.assignee_available ? '<small>Reatribuição necessária</small>' : ''}</span>`;
let state, currentView = 'dashboard', registering = false, noticeTimer;
async function api(path, body) {
  const res = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && state) { state = null; $('#modal').close(); showAuth(); }
    throw new Error(data.error || 'Não foi possível concluir.');
  }
  return data;
}
function notify(message) { clearTimeout(noticeTimer); $('#notice').textContent = message; $('#notice').hidden = false; noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 6000); }
function clearRequestFilters() {
  for (const id of ['request-search', 'status-filter', 'deadline-filter', 'assignment-filter', 'sector-filter', 'priority-filter']) $(`#${id}`).value = '';
}
function showAuth() { currentView = 'dashboard'; clearRequestFilters(); $('#workspace').hidden = true; $('#auth').hidden = false; }
function authMode(value) {
  registering = value;
  $('#registration-fields').hidden = !value;
  for (const input of $('#registration-fields').querySelectorAll('input')) input.required = value;
  $('#password-help').hidden = !value;
  $('#auth-password').minLength = value ? 12 : 1;
  $('#auth-password').autocomplete = value ? 'new-password' : 'current-password';
  $('#login-tab').classList.toggle('active', !value); $('#register-tab').classList.toggle('active', value);
  $('#auth-title').textContent = value ? 'Sua organização começa aqui' : 'Bem-vindo ao COSMOS';
  $('#auth-description').textContent = value ? 'Crie um espaço exclusivo para conectar sua equipe.' : 'Entre para acompanhar o que acontece na sua organização.';
  $('#auth-submit').textContent = value ? 'Criar organização ↗' : 'Acessar minha conta ↗'; $('#auth-error').textContent = '';
}
$('#login-tab').onclick = () => authMode(false); $('#register-tab').onclick = () => authMode(true);
$('#auth-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#auth-submit'); button.disabled = true; $('#auth-error').textContent = '';
  try { await api(registering ? '/register' : '/login', Object.fromEntries(new FormData(event.target))); event.target.reset(); await refresh(); }
  catch (error) { $('#auth-error').textContent = error.message; } finally { button.disabled = false; }
};
async function logout() { try { await api('/logout', {}); state = null; $('#modal').close(); showAuth(); } catch (error) { notify(error.message); } }
$('#logout').onclick = logout;
$('#account-settings').onclick = () => {
  openModal('Minha conta', `<p class="detail-meta">${escapeHTML(state.user.name)}<br>${escapeHTML(state.user.email)}</p><form id="password-form"><label>Senha atual<input name="currentPassword" type="password" required maxlength="128" autocomplete="current-password"></label><label>Nova senha<input name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>Confirme a nova senha<input name="confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="hint">Use pelo menos 12 caracteres. Ao salvar, todas as sessões da sua conta serão encerradas. Entre novamente com a nova senha.</p><p id="password-error" class="error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Alterar senha</button></div></form>`);
  $('#password-form').onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const errorBox = $('#password-error'); errorBox.textContent = '';
    if (data.newPassword !== data.confirmation) { errorBox.textContent = 'A confirmação não corresponde à nova senha.'; return; }
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      await api('/account/password', { currentPassword: data.currentPassword, newPassword: data.newPassword });
      state = null; currentView = 'dashboard'; $('#modal').close();
      $('#auth-form').reset(); authMode(false); showAuth();
      notify('Senha alterada. Entre novamente com a nova senha.');
    } catch (error) { errorBox.textContent = error.message; }
    finally { button.disabled = false; }
  };
};

const mobileLogout = document.createElement('button'); mobileLogout.className = 'mobile-logout'; mobileLogout.textContent = 'Sair ↪'; mobileLogout.onclick = logout;
// A conta permanece acessível também no menu compacto.
const media = window.matchMedia('(max-width:760px)');
function responsiveLogout() { if (media.matches) $('.sidebar').append(mobileLogout); else mobileLogout.remove(); }
media.addEventListener('change', responsiveLogout); responsiveLogout();
const viewInfo = {
  dashboard: ['Início', 'TUDO EM SEU LUGAR', 'Acompanhe sua organização e faça o trabalho avançar.', '+ Nova solicitação'],
  requests: ['Solicitações', 'DO PEDIDO À DECISÃO', 'Crie, acompanhe e consulte as solicitações.', '+ Nova solicitação'],
  sectors: ['Setores', 'UMA ESTRUTURA CONECTADA', 'Organize as áreas que fazem sua organização acontecer.', '+ Novo setor'],
  people: ['Pessoas', 'QUEM FAZ ACONTECER', 'Cadastre sua equipe e defina os perfis de acesso.', '+ Nova pessoa'],
  history: ['Histórico', 'CADA ETAPA REGISTRADA', 'Consulte as últimas 50 ações da sua organização.', null]
};
function setView(view) {
  if (!state || !viewInfo[view] || (['people', 'history'].includes(view) && state.user.role !== 'admin')) return;
  const changedView = currentView !== view;
  currentView = view;
  $('#workspace').dataset.currentView = view;
  for (const key of Object.keys(viewInfo)) $(`#${key}-view`).hidden = key !== view;
  for (const button of document.querySelectorAll('[data-view]')) { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  const [title, kicker, description, action] = viewInfo[view];
  $('#page-title').textContent = title; $('#breadcrumb').textContent = title; $('#page-kicker').textContent = kicker; $('#page-description').textContent = description;
  $('#main-action').textContent = action || ''; $('#main-action').hidden = !action || (view === 'sectors' && state.user.role !== 'admin');
  if (changedView) window.scrollTo({ top: 0, behavior: 'auto' });
}
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => setView(button.dataset.view);
$('#see-all').onclick = () => setView('requests');
$('#my-review-queue').onclick = () => { clearRequestFilters(); $('#status-filter').value = 'pendente'; $('#assignment-filter').value = 'mine'; renderRequests(); setView('requests'); };
$('#sidebar-new').onclick = () => requestForm();
$('#hero-new').onclick = () => requestForm();
$('#shortcut-requests').onclick = () => setView('requests');
$('#shortcut-sectors').onclick = () => setView('sectors');
$('#shortcut-help').onclick = () => showGuide();
$('#main-action').onclick = () => ({ sectors: sectorForm, people: userForm }[currentView] || requestForm)();

const pill = status => `<span class="pill ${status}">${statusName[status]}</span>`;
function table(requests) {
  if (!requests.length) return '<div class="empty"><strong>Nenhuma solicitação por aqui.</strong>Crie uma solicitação ou ajuste os filtros para começar.</div>';
  return `<table class="data-table request-table"><thead><tr><th>SOLICITAÇÃO</th><th>SETOR</th><th>SITUAÇÃO</th><th>PRIORIDADE</th><th>PRAZO</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${requests.map(r => `<tr><td data-label="Solicitação"><span class="request-title">${escapeHTML(r.title)}</span><span class="request-id">COS-${String(r.id).padStart(5, '0')} · ${escapeHTML(r.author)}</span><span class="request-assignee-line">Responsável: ${assigneeBadge(r)}</span></td><td data-label="Setor">${escapeHTML(r.sector)}</td><td data-label="Situação">${pill(r.status)}</td><td data-label="Prioridade"><span class="priority ${r.priority}">${escapeHTML(r.priority[0].toUpperCase() + r.priority.slice(1))}</span></td><td data-label="Prazo">${deadlineBadge(r)}</td><td data-label="Ações"><button class="row-open" data-request="${r.id}" aria-label="Abrir solicitação ${r.id}">Abrir ↗</button></td></tr>`).join('')}</tbody></table>`;
}
function renderRequests() {
  const search = $('#request-search').value.trim().toLocaleLowerCase('pt-BR'); const status = $('#status-filter').value;
  const overdueOnly = $('#deadline-filter').value === 'overdue';
  const assignment = state.user.role === 'admin' ? $('#assignment-filter').value : '';
  const sector = $('#sector-filter').value, priority = $('#priority-filter').value;
  const filtered = state.requests.filter(r => (!sector || r.sector_id === Number(sector)) && (!priority || r.priority === priority) && (!status || r.status === status) && (!overdueOnly || r.is_overdue) && (!assignment || (r.status === 'pendente' && (assignment === 'mine' ? r.assigned_to === state.user.id && r.assignee_available === 1 : !r.assigned_to || r.assignee_available !== 1))) && `${r.title} COS-${String(r.id).padStart(5, '0')}`.toLocaleLowerCase('pt-BR').includes(search));
  $('#all-requests').innerHTML = table(filtered);
  $('#request-results').textContent = `${filtered.length} de ${state.requests.length} ${state.requests.length === 1 ? 'solicitação' : 'solicitações'}`;
}
$('#request-search').oninput = renderRequests; $('#status-filter').onchange = renderRequests;
$('#deadline-filter').onchange = renderRequests;
$('#sector-filter').onchange = renderRequests; $('#priority-filter').onchange = renderRequests;
$('#clear-request-filters').onclick = () => { clearRequestFilters(); renderRequests(); };
$('#assignment-filter').onchange = () => { if ($('#assignment-filter').value) $('#status-filter').value = 'pendente'; renderRequests(); };
$('#overdue-alert').onclick = () => { clearRequestFilters(); $('#status-filter').value = 'pendente'; $('#deadline-filter').value = 'overdue'; renderRequests(); setView('requests'); };
$('#export-requests').onclick = async () => {
  const button = $('#export-requests'); button.disabled = true; button.textContent = 'Preparando…';
  const params = new URLSearchParams({ q: $('#request-search').value.trim(), status: $('#status-filter').value, deadline: $('#deadline-filter').value, assignment: $('#assignment-filter').value, sector_id: $('#sector-filter').value, priority: $('#priority-filter').value });
  try {
    const response = await fetch(`/api/requests/export.csv?${params}`);
    if (!response.ok) {
      const data = await response.json();
      if (response.status === 401) { state = null; $('#modal').close(); showAuth(); }
      throw new Error(data.error || 'Não foi possível exportar.');
    }
    const file = await response.blob();
    const url = URL.createObjectURL(file); const link = document.createElement('a');
    link.href = url; link.download = 'cosmos-solicitacoes.csv'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify('Arquivo preparado para download.');
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; button.textContent = 'Exportar CSV ↓'; }
};

async function refresh() {
  state = await api('/workspace'); $('#auth').hidden = true; $('#workspace').hidden = false;
  const admin = state.user.role === 'admin';
  if (!admin && ['people', 'history'].includes(currentView)) currentView = 'dashboard';
  if (!admin) $('#assignment-filter').value = '';
  for (const el of document.querySelectorAll('[data-admin]')) el.hidden = !admin;
  $('#org-name').textContent = state.organization.name; $('#org-type').textContent = state.organization.type === 'publica' ? 'Organização pública' : 'Empresa privada';
  $('#account-name').textContent = state.user.name; $('#account-role').textContent = admin ? 'Administrador' : 'Colaborador';
  $('#avatar').textContent = state.user.name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  $('#my-review-queue').textContent = `Minha fila (${state.requests.filter(r => r.status === 'pendente' && r.assigned_to === state.user.id && r.assignee_available === 1).length})`;
  $('#today').textContent = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  $('#greeting').textContent = `Olá, ${state.user.name.split(' ')[0]}`;
  const pending = state.requests.filter(r => r.status === 'pendente').length; $('#pending-count').textContent = pending;
  const metrics = [['Pendentes', pending, 'Aguardando uma decisão', 'clock'], ['Aprovadas', state.requests.filter(r => r.status === 'aprovada').length, 'Pedidos autorizados', 'check'], ['Total de pedidos', state.requests.length, 'Todas as situações', 'document'], ['Setores ativos', state.sectors.filter(s => s.active).length, 'Áreas da organização', 'sectors']];
  const overdueCount = state.requests.filter(r => r.is_overdue).length;
  $('#overdue-alert').hidden = overdueCount === 0;
  $('#overdue-alert').innerHTML = `${icon('clock')}<span><strong>${overdueCount} ${overdueCount === 1 ? 'solicitação com prazo vencido' : 'solicitações com prazo vencido'}</strong><small>Veja os pedidos pendentes que precisam de atenção.</small></span>${icon('arrow')}`;
  $('#metrics').innerHTML = metrics.map(([label, value, subtitle, symbol]) => `<article class="metric"><span class="metric-symbol">${icon(symbol)}</span><div class="metric-content"><span class="metric-label">${label}</span><strong>${value}</strong><small>${subtitle}</small></div></article>`).join('');
  const selectedSector = $('#sector-filter').value;
  $('#sector-filter').innerHTML = '<option value="">Todos os setores</option>' + state.sectors.map(s => `<option value="${s.id}">${escapeHTML(s.name)}${s.active ? '' : ' (desativado)'}</option>`).join('');
  $('#sector-filter').value = state.sectors.some(s => String(s.id) === selectedSector) ? selectedSector : '';
  $('#recent-requests').innerHTML = table(state.requests.slice(0, 5)); renderRequests();
  $('#sector-grid').innerHTML = state.sectors.map(s => `<article class="sector-card"><span class="sector-symbol">${icon('sectors')}</span><h2>${escapeHTML(s.name)}</h2><p class="sector-description">${escapeHTML(s.description || 'Descrição não informada.')}</p><p class="sector-meta">${s.active ? 'Ativo' : 'Desativado'}${admin ? ' · ' + state.users.filter(u => u.sector_id === s.id && u.active).length + ' pessoa(s) ativa(s)' : ''}</p>${admin ? `<button type="button" class="row-open sector-edit" data-sector="${s.id}" aria-label="Editar setor ${escapeHTML(s.name)}">Editar ↗</button>` : ''}</article>`).join('');
  $('#people-table').innerHTML = `<table class="data-table"><thead><tr><th>NOME</th><th>E-MAIL</th><th>SETOR</th><th>PERFIL</th><th>ACESSO</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${state.users.map(u => `<tr><td>${escapeHTML(u.name)}</td><td>${escapeHTML(u.email)}</td><td>${escapeHTML(u.sector)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Colaborador'}</td><td>${u.active ? 'Ativo' : 'Desativado'}</td><td><button class="row-open" data-person="${u.id}" aria-label="Editar ${escapeHTML(u.name)}">Editar ↗</button></td></tr>`).join('')}</tbody></table>`;
  $('#history-list').innerHTML = state.history.map(h => `<article class="history-item"><span class="history-dot">${icon('clock')}</span><div>${escapeHTML(h.action)}<small>${escapeHTML(h.actor)} · ${date(h.created_at)}</small></div></article>`).join('') || '<div class="empty">Nenhuma movimentação registrada.</div>';
  setView(currentView);
}
$('#workspace').addEventListener('click', event => { const button = event.target.closest('[data-request]'); if (button) showRequest(Number(button.dataset.request)); const person = event.target.closest('[data-person]'); if (person) editUserForm(Number(person.dataset.person)); const sector = event.target.closest('[data-sector]'); if (sector) editSectorForm(Number(sector.dataset.sector)); });
$('#close-modal').onclick = () => $('#modal').close();
function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; if (!$('#modal').open) $('#modal').showModal(); }
function showGuide() {
  const admin = state.user.role === 'admin';
  openModal('Seu caminho no COSMOS', `<p class="guide-intro">Um pedido de cada vez. Veja como é simples acompanhar sua rotina por aqui.</p><ol class="guide-steps"><li><span>1</span><div><h3>Conte o que você precisa</h3><p>Crie uma solicitação com título, setor, prioridade e uma justificativa clara.</p></div></li><li><span>2</span><div><h3>Acompanhe a decisão</h3><p>Abra o pedido em Solicitações para ver a situação e o parecer. ${admin ? 'Como administrador, você também pode avaliar os pedidos de outras pessoas.' : 'Os administradores da organização analisam os pedidos.'}</p></div></li><li><span>3</span><div><h3>Mantenha a conversa por perto</h3><p>Use os comentários do pedido para esclarecer dúvidas, inclusive depois da decisão.</p></div></li></ol>${admin ? '<p class="hint">Em Pessoas e Setores você organiza a equipe. Pedidos próprios precisam ser avaliados por outro administrador.</p>' : '<p class="hint">Você acompanha seus próprios pedidos. Para atualizar seu cadastro, procure um administrador.</p>'}<div class="form-actions"><button type="button" class="secondary" id="guide-browse">Ver solicitações</button><button type="button" class="primary" id="guide-new">Criar meu pedido ${icon('arrow')}</button></div>`);
  $('#guide-browse').onclick = () => { $('#modal').close(); setView('requests'); };
  $('#guide-new').onclick = () => { $('#modal').close(); requestForm(); };
}
function sectorOptions() { return state.sectors.filter(s => s.active).map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join(''); }
function formModal(title, fields, endpoint, convert = data => data, success = 'Cadastro realizado.') {
  openModal(title, `<form id="modal-form">${fields}<p class="error" id="modal-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary" id="cancel-form">Cancelar</button><button class="primary" type="submit">Salvar ↗</button></div></form>`);
  $('#cancel-form').onclick = () => $('#modal').close();
  $('#modal-form').onsubmit = async event => {
    event.preventDefault(); const submit = event.target.querySelector('[type=submit]'); submit.disabled = true; $('#modal-error').textContent = '';
    try { await api(endpoint, convert(Object.fromEntries(new FormData(event.target)))); $('#modal').close(); await refresh(); notify(success); }
    catch (error) { const target = $('#modal-error'); if (target) target.textContent = error.message; else notify(error.message); } finally { submit.disabled = false; }
  };
}
function requestForm() {
  if (!state.sectors.some(s => s.active)) { notify('Peça ao administrador para ativar ou cadastrar um setor.'); return; }
  formModal('Nova solicitação', `<label>Título<input name="title" required maxlength="160" placeholder="Ex.: Aquisição de material de escritório"></label><label>Setor responsável<select name="sector_id" required>${sectorOptions()}</select></label><label>Prioridade<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label><label>Descrição e justificativa<textarea name="description" required maxlength="5000" placeholder="Descreva o que você precisa e por quê."></textarea></label>`, '/requests', data => ({ ...data, sector_id: Number(data.sector_id) }), 'Solicitação enviada para avaliação.');
}
function sectorForm() { formModal('Novo setor', '<label>Nome do setor<input name="name" required maxlength="120" placeholder="Ex.: Recursos Humanos"></label><label>O que este setor faz<textarea name="description" maxlength="300" placeholder="Explique em uma ou duas frases como esta área ajuda a organização."></textarea></label>', '/sectors'); }
function editSectorForm(id) {
  const sector = state.sectors.find(s => s.id === id);
  if (!sector || state.user.role !== 'admin') return;
  formModal('Editar setor', `<label>Nome do setor<input name="name" required maxlength="120" value="${escapeHTML(sector.name)}"></label><label>O que este setor faz<textarea name="description" maxlength="300">${escapeHTML(sector.description || '')}</textarea></label><label>Situação<select name="active"><option value="true" ${sector.active ? 'selected' : ''}>Ativo</option><option value="false" ${!sector.active ? 'selected' : ''}>Desativado</option></select></label><p class="hint">Para desativar, transfira ou desative as pessoas ativas e avalie os pedidos pendentes do setor. Pedidos concluídos e histórico são preservados. O novo nome aparecerá também nos pedidos já registrados.</p>`, `/sectors/${id}`, data => ({ name: data.name, description: data.description, active: data.active === 'true' }), 'Setor atualizado.');
}
function userForm() {
  if (!state.sectors.some(s => s.active)) { notify('Ative ou cadastre um setor antes de adicionar pessoas.'); return; }
  formModal('Cadastrar pessoa', `<label>Nome completo<input name="name" required maxlength="120" autocomplete="name"></label><label>E-mail<input name="email" required type="email" maxlength="200" autocomplete="off"></label><label>Senha inicial<input name="password" required type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><p class="hint">Use pelo menos 12 caracteres. Entregue as credenciais à pessoa por um canal seguro.</p><label>Setor<select name="sector_id" required>${sectorOptions()}</select></label><label>Perfil de acesso<select name="role"><option value="colaborador">Colaborador — cria e acompanha seus pedidos</option><option value="admin">Administrador — gerencia equipe e aprova pedidos</option></select></label>`, '/users', data => ({ ...data, sector_id: Number(data.sector_id) }));
}
function editUserForm(id) {
  const person = state.users.find(user => user.id === id);
  if (!person || state.user.role !== 'admin') return;
  const self = id === state.user.id;
  formModal('Editar pessoa', `<p class="detail-meta">${escapeHTML(person.email)}</p><label>Nome completo<input name="name" required maxlength="120" value="${escapeHTML(person.name)}"></label><label>Setor<select name="sector_id" required>${state.sectors.filter(s => s.active || s.id === person.sector_id).map(s => `<option value="${s.id}" ${s.id === person.sector_id ? 'selected' : ''}>${escapeHTML(s.name)}${s.active ? '' : ' (desativado)'}</option>`).join('')}</select></label><label>Perfil de acesso<select name="role" ${self ? 'disabled' : ''}><option value="colaborador" ${person.role === 'colaborador' ? 'selected' : ''}>Colaborador</option><option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label><label>Acesso ao COSMOS<select name="active" ${self ? 'disabled' : ''}><option value="true" ${person.active ? 'selected' : ''}>Ativo</option><option value="false" ${!person.active ? 'selected' : ''}>Desativado</option></select></label><p class="hint">${self ? 'Outro administrador deve alterar seu perfil ou desativar seu acesso.' : 'Desativar bloqueia novos logins e encerra as sessões. Alterar o perfil também exige novo login. Solicitações e histórico são preservados. Reativar não recupera sessões anteriores.'}</p>`, `/users/${id}`, data => ({ name: data.name, sector_id: Number(data.sector_id), role: self ? person.role : data.role, active: self ? Boolean(person.active) : data.active === 'true' }), 'Pessoa atualizada.');
}
function mountRequestHistory(id) {
  const section = document.createElement('section'); section.className = 'request-history';
  section.innerHTML = '<div class="section-heading"><h3>Movimentações</h3><button type="button" class="text-button" data-history-reload>Atualizar ↻</button></div><p class="hint">Da mais recente para a mais antiga. Inclui ações registradas após a atualização que habilitou este histórico por pedido.</p><div data-history-list aria-live="polite"></div><button type="button" class="secondary" data-history-older hidden>Carregar movimentações anteriores</button><p class="error" data-history-error role="alert"></p>';
  $('#modal-body').append(section);
  const list = section.querySelector('[data-history-list]'), older = section.querySelector('[data-history-older]'), reload = section.querySelector('[data-history-reload]'), error = section.querySelector('[data-history-error]');
  let nextBefore = null, loading = false;
  async function load(before = null) {
    if (loading) return;
    loading = true; older.disabled = true; reload.disabled = true; error.textContent = '';
    try {
      const data = await api(`/requests/${id}/history${before === null ? '' : `?before=${before}`}`);
      if (!section.isConnected) return;
      const html = data.history.map(h => `<article class="history-item"><span class="history-dot">${icon('clock')}</span><div>${escapeHTML(h.action)}<small>${escapeHTML(h.actor)} · ${date(h.created_at)}</small></div></article>`).join('');
      if (before === null) list.innerHTML = html || '<p class="hint">Nenhuma movimentação registrada nesta versão para este pedido.</p>';
      else list.insertAdjacentHTML('beforeend', html);
      nextBefore = data.nextBefore; older.hidden = nextBefore === null;
    } catch (e) { if (section.isConnected) error.textContent = e.message; }
    finally { loading = false; older.disabled = false; reload.disabled = false; }
  }
  older.onclick = () => load(nextBefore); reload.onclick = () => load();
  load();
}
function mountComments(id) {
  const section = document.createElement('section'); section.className = 'request-comments';
  section.innerHTML = '<div class="section-heading"><h3>Comentários</h3><button type="button" class="text-button" data-reload>Atualizar ↻</button></div><p class="hint">Visíveis ao solicitante e aos administradores. Você também pode comentar após a decisão.</p><button type="button" class="secondary" data-older hidden>Carregar anteriores</button><div data-comment-list aria-live="polite"></div><p class="error" data-load-error role="alert"></p><form data-comment-form><label>Adicionar comentário<textarea name="content" required maxlength="2000" placeholder="Registre um esclarecimento ou uma atualização."></textarea></label><p class="error" data-send-error role="alert"></p><div class="form-actions"><button class="primary" type="submit">Enviar comentário ↗</button></div></form>';
  $('#modal-body').append(section);
  const list = section.querySelector('[data-comment-list]');
  const older = section.querySelector('[data-older]'); const reload = section.querySelector('[data-reload]');
  const loadError = section.querySelector('[data-load-error]'); const sendError = section.querySelector('[data-send-error]');
  let nextBefore = null, loading = false;
  async function load(before = null) {
    if (loading) return false;
    loading = true; older.disabled = true; reload.disabled = true; loadError.textContent = '';
    try {
      const data = await api(`/requests/${id}/comments${before === null ? '' : `?before=${before}`}`);
      if (!section.isConnected) return false;
      const html = data.comments.map(comment => `<article class="request-comment"><div><strong>${escapeHTML(comment.author)}</strong><time>${date(comment.created_at)}</time></div><p>${escapeHTML(comment.content)}</p></article>`).join('');
      if (before === null) list.innerHTML = html || '<p class="hint">Ainda não há comentários. Comece a conversa.</p>';
      else list.insertAdjacentHTML('afterbegin', html);
      nextBefore = data.nextBefore; older.hidden = nextBefore === null; return true;
    } catch (error) { if (section.isConnected) loadError.textContent = error.message; return false; }
    finally { loading = false; older.disabled = false; reload.disabled = false; }
  }
  older.onclick = () => load(nextBefore); reload.onclick = () => load();
  section.querySelector('[data-comment-form]').onsubmit = async event => {
    event.preventDefault(); const content = new FormData(event.target).get('content').trim();
    sendError.textContent = ''; if (!content) { sendError.textContent = 'Escreva um comentário antes de enviar.'; return; }
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      await api(`/requests/${id}/comments`, { content });
      if (!section.isConnected) return;
      event.target.reset();
      // A lista é recarregada separadamente: uma falha de leitura não permite reenviar o mesmo texto por engano.
      notify('Comentário enviado.');
      if (!loading) await load();
      else loadError.textContent = 'Comentário salvo. Clique em Atualizar para ver a conversa mais recente.';
    } catch (error) { if (section.isConnected) sendError.textContent = error.message; }
    finally { button.disabled = false; }
  };
  load();
}
function assigneeForm(request) {
  const candidates = state.users.filter(user => user.active && user.role === 'admin' && user.id !== request.user_id);
  const unavailable = request.assigned_to && !candidates.some(user => user.id === request.assigned_to);
  const options = `<option value="">Sem responsável</option>${unavailable ? `<option value="${request.assigned_to}" selected>${escapeHTML(request.assignee_name || 'Responsável anterior')} — indisponível; escolha outro</option>` : ''}${candidates.map(user => `<option value="${user.id}" ${user.id === request.assigned_to ? 'selected' : ''}>${escapeHTML(user.name)}</option>`).join('')}`;
  formModal(`Responsável · COS-${String(request.id).padStart(5, '0')}`, `<label>Administrador responsável<select name="assigned_to">${options}</select></label><p class="hint">Escolha um administrador ativo da organização, diferente do solicitante. A atribuição organiza o acompanhamento; os administradores continuam podendo avaliar pedidos de outras pessoas. Selecione Sem responsável para remover o vínculo.</p>${!candidates.length ? '<p class="hint">Nenhum administrador elegível. Cadastre outro administrador em Pessoas para atribuir este pedido.</p>' : ''}`, `/requests/${request.id}/assignee`, data => ({ assigned_to: data.assigned_to ? Number(data.assigned_to) : null }), 'Responsável atualizado.');
}
function deadlineForm(request) {
  formModal(`Prazo · COS-${String(request.id).padStart(5, '0')}`, `<label>Data limite<input name="due_date" type="date" min="1000-01-01" max="9999-12-31" value="${escapeHTML(request.due_date || '')}"></label><p class="hint">Deixe vazio para remover o prazo. O pedido vence após o fim da data escolhida, no horário de Brasília. Datas passadas são aceitas e aparecem como vencidas enquanto o pedido estiver pendente.</p>`, `/requests/${request.id}/deadline`, data => ({ due_date: data.due_date || null }), 'Prazo atualizado.');
}
function showRequest(id) {
  const r = state.requests.find(r => r.id === id); if (!r) return;
  const canDecide = state.user.role === 'admin' && r.status === 'pendente' && r.user_id !== state.user.id;
  openModal(`Solicitação COS-${String(id).padStart(5, '0')}`, `${pill(r.status)}<h3 class="detail-title">${escapeHTML(r.title)}</h3><p class="detail-meta">Solicitante: ${escapeHTML(r.author)}<br>Setor: ${escapeHTML(r.sector)} · Prioridade: ${escapeHTML(r.priority)}<br>Enviada em ${date(r.created_at)}<br>Prazo: ${deadlineBadge(r)}<br>Responsável pela análise: ${assigneeBadge(r)}</p>${state.user.role === 'admin' && r.status === 'pendente' ? '<div class="request-management-actions"><button type="button" class="secondary" id="edit-deadline">Definir ou alterar prazo</button><button type="button" class="secondary" id="edit-assignee">Definir responsável</button></div>' : ''}<div class="detail-description">${escapeHTML(r.description)}</div>${r.decision ? `<div class="decision-note"><strong>Decisão de ${escapeHTML(r.reviewer)} · ${date(r.decided_at)}</strong><p>${escapeHTML(r.decision)}</p></div>` : ''}${r.user_id === state.user.id && state.user.role === 'admin' && r.status === 'pendente' ? '<p class="hint">Outro administrador deve avaliar seu pedido. Você pode cadastrá-lo em Pessoas.</p>' : ''}${canDecide ? '<form id="decision-form"><label>Parecer<textarea name="decision" required maxlength="2000" placeholder="Registre o motivo da decisão."></textarea></label><p class="error" id="decision-error" role="alert"></p><div class="form-actions"><button type="submit" name="status" value="recusada" class="primary danger">Recusar</button><button type="submit" name="status" value="aprovada" class="primary">Aprovar ↗</button></div></form>' : ''}`);
  if ($('#edit-deadline')) $('#edit-deadline').onclick = () => deadlineForm(r);
  if ($('#edit-assignee')) $('#edit-assignee').onclick = () => assigneeForm(r);
  mountComments(id);
  mountRequestHistory(id);
  if (canDecide) $('#decision-form').onsubmit = async event => {
    event.preventDefault(); const buttons = event.target.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
    try { await api(`/requests/${id}/decision`, { decision: new FormData(event.target).get('decision'), status: event.submitter.value }); $('#modal').close(); await refresh(); notify('Decisão registrada.'); }
    catch (error) { if ($('#decision-error')) $('#decision-error').textContent = error.message; else notify(error.message); } finally { buttons.forEach(b => b.disabled = false); }
  };
}
refresh().catch(error => { showAuth(); if (!error.message.includes('Entre na sua conta')) notify(error.message); });

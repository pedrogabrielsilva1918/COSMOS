import { matchesRequestPeriod, periodError } from './request-period.js';
import { matchesRequestSearch } from './request-search.js';
import { orderRequests } from './request-order.js';
import { summarizeSectors } from './sector-overview.js';
import { filterSectors } from './sector-search.js';
import { filterPeople } from './people-search.js';
'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const statusName = { pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada' };
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const formatDeadline = value => value ? String(value).split('-').reverse().join('/') : 'Sem prazo';
const deadlineBadge = request => `<span class="deadline-label ${request.is_overdue ? 'deadline-late' : ''}">${escapeHTML(formatDeadline(request.due_date))}${request.is_overdue ? '<small>Prazo vencido</small>' : ''}</span>`;
const assigneeBadge = request => `<span class="request-assignee">${escapeHTML(request.assignee_name || 'Não definido')}${request.status === 'pendente' && request.assigned_to && !request.assignee_available ? '<small>Reatribuição necessária</small>' : ''}</span>`;
let state, currentView = 'dashboard', registering = false, noticeTimer, workspaceEpoch = 0, refreshSequence = 0;
let notificationGeneration = 0, notificationNextBefore = null, notificationCount = 0, notificationReadThrough = null;
let requestPage = 1;
let pendingLinkedRequest = new URLSearchParams(location.search).get('pedido');
let historyGeneration = 0, historyNextBefore = null, historyLoadedQuery = '', historyCount = 0;
async function api(path, body) {
  const epoch = workspaceEpoch, sequence = refreshSequence;
  const res = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && epoch === workspaceEpoch && (path !== '/workspace' || sequence === refreshSequence) && state) { state = null; $('#modal').close(); showAuth(); }
    throw new Error(data.error || 'Não foi possível concluir.');
  }
  return data;
}
function notify(message) { clearTimeout(noticeTimer); $('#notice').textContent = message; $('#notice').hidden = false; noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 6000); }
function clearRequestFilters() {
  requestPage = 1;
  $('#request-advanced').open = false;
  $('#request-order').value = 'recent';
  for (const id of ['request-search', 'status-filter', 'deadline-filter', 'assignment-filter', 'sector-filter', 'priority-filter', 'created-from', 'created-to']) $(`#${id}`).value = '';
}
function showAuth() { $('#request-summary-metrics').replaceChildren(); workspaceEpoch++; refreshSequence++; $('#refresh-workspace').disabled = false; $('#refresh-workspace').textContent = 'Atualizar dados ↻'; $('#refresh-workspace').removeAttribute('aria-busy'); $('#workspace-updated').textContent = ''; currentView = 'dashboard'; clearRequestFilters(); clearSectorFilters(); clearPeopleFilters(); resetHistory(); resetNotifications(); $('#workspace').hidden = true; $('#auth').hidden = false; }
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
  try { await api(registering ? '/register' : '/login', Object.fromEntries(new FormData(event.target))); workspaceEpoch++; refreshSequence++; event.target.reset(); await refresh(); }
  catch (error) { $('#auth-error').textContent = error.message; } finally { button.disabled = false; }
};
async function logout() { try { await api('/logout', {}); state = null; $('#modal').close(); showAuth(); } catch (error) { notify(error.message); } }
$('#logout').onclick = logout;
$('#account-settings').onclick = () => {
  openModal('Minha conta', `<p class="detail-meta">${escapeHTML(state.user.name)}<br>${escapeHTML(state.user.email)}</p><button type="button" class="text-button" id="edit-my-name">Editar meu nome</button><hr><form id="password-form"><label>Senha atual<input name="currentPassword" type="password" required maxlength="128" autocomplete="current-password"></label><label>Nova senha<input name="newPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>Confirme a nova senha<input name="confirmation" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="hint">Use pelo menos 12 caracteres. Ao salvar, todas as sessões da sua conta serão encerradas. Entre novamente com a nova senha.</p><p id="password-error" class="error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Alterar senha</button></div></form><hr><h3>Outros acessos</h3><p class="hint">Encerre os acessos da sua conta nos outros navegadores. Este acesso continuará aberto. A senha permanece a mesma.</p><button type="button" id="revoke-other-sessions" class="secondary">Encerrar outros acessos</button><p id="sessions-result" class="hint" role="status" aria-live="polite"></p>`);
  $('#edit-my-name').onclick = () => {
    const expectedName = state.user.name;
    formModal('Editar meu nome', `<label>Nome completo<input name="name" required maxlength="120" autocomplete="name" value="${escapeHTML(expectedName)}"></label><p class="hint">O novo nome aparecerá nos pedidos, comentários e na identificação da conta. E-mail, setor e perfil de acesso permanecem como estão.</p>`, '/account/profile', data => ({name:data.name,expectedName}), 'Nome atualizado.');
  };
  $('#revoke-other-sessions').onclick = async event => {
    const button = event.currentTarget, result = $('#sessions-result'), epoch = workspaceEpoch;
    button.disabled = true; result.textContent = 'Encerrando outros acessos…';
    try {
      const data = await api('/account/sessions/revoke-others', {});
      if (epoch === workspaceEpoch && state) result.textContent = data.revoked ? 'Outros acessos encerrados. Você continua conectado aqui.' : 'Nenhum outro acesso para encerrar.';
    } catch(error) { if (epoch === workspaceEpoch && state) result.textContent = error.message; }
    finally { button.disabled = false; }
  };
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
  notifications: ['Notificações', 'ACOMPANHE CADA DECISÃO', 'As decisões dos seus pedidos, em um só lugar.', null],
  history: ['Histórico', 'CADA ETAPA REGISTRADA', 'Consulte e pesquise as ações registradas da sua organização.', null]
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
  if (view === 'history') return loadHistory();
  if (view === 'notifications') return loadNotifications();
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
function updateNotificationBadge(count) {
  $('#notification-read-all').disabled = count === 0 || notificationReadThrough === null || $('#notification-filter').value === 'read';
  $('#notification-count').textContent = count; $('#notification-count').hidden = count === 0;
}
function resetNotifications() {
  notificationGeneration++; notificationNextBefore = null; notificationCount = 0; notificationReadThrough = null;
  $('#notification-filter').value = 'all';
  $('#notification-list').replaceChildren(); $('#notification-results').textContent = ''; $('#notification-error').textContent = ''; $('#notification-older').hidden = true; $('#notification-older').disabled = false; updateNotificationBadge(0);
}
async function loadNotifications(before = null) {
  if (!state) return;
  const generation = ++notificationGeneration, epoch = workspaceEpoch, status = $('#notification-filter').value;
  $('#notification-older').disabled = true; $('#notification-error').textContent = ''; $('#notification-results').textContent = 'Consultando avisos…';
  try {
    const params = new URLSearchParams({ status });
    if (before !== null) params.set('before',before);
    const data = await api(`/notifications?${params}`);
    if (generation !== notificationGeneration || epoch !== workspaceEpoch || !state) return;
    const html = data.notifications.map(n => `<article class="notification-card ${n.read_at ? '' : 'notification-unread'}"><span class="notification-symbol">${icon('bell')}</span><div class="notification-content"><span class="notification-state">${n.read_at ? 'Lida' : 'Não lida'}</span><h2>${escapeHTML(n.message)}</h2><p>${escapeHTML(n.actor)} · ${date(n.created_at)}</p><div class="notification-actions"><button type="button" class="row-open" data-notification="${n.id}" data-open-request="${n.request_id}">Ver pedido ↗</button>${n.read_at ? '' : `<button type="button" class="text-button" data-notification="${n.id}">Marcar como lida</button>`}</div></div></article>`).join('');
    if (before === null) $('#notification-list').innerHTML = html || `<div class="empty panel"><strong>${status === 'unread' ? 'Nenhum aviso não lido.' : status === 'read' ? 'Nenhum aviso lido.' : 'Nenhuma notificação por enquanto.'}</strong>${status === 'all' ? 'As novas aprovações e recusas dos seus pedidos aparecerão aqui.' : 'Escolha Todos para consultar os demais avisos.'}</div>`;
    else $('#notification-list').insertAdjacentHTML('beforeend',html);
    notificationCount = before === null ? data.notifications.length : notificationCount + data.notifications.length;
    notificationNextBefore = data.nextBefore; $('#notification-older').hidden = notificationNextBefore === null;
    if (before === null) notificationReadThrough = data.notifications[0]?.id ?? null;
    updateNotificationBadge(data.unreadCount); state.notification_unread = data.unreadCount;
    $('#notification-results').textContent = `${notificationCount} ${notificationCount === 1 ? 'aviso exibido' : 'avisos exibidos'} · ${data.unreadCount} não ${data.unreadCount === 1 ? 'lido' : 'lidos'} no total`;
  } catch(error) {
    if (generation === notificationGeneration && epoch === workspaceEpoch) { $('#notification-error').textContent = error.message; $('#notification-results').textContent = notificationCount ? 'Não foi possível atualizar. Os avisos anteriores foram mantidos.' : ''; }
  } finally { if (generation === notificationGeneration && epoch === workspaceEpoch) $('#notification-older').disabled = false; }
}
$('#notification-filter').onchange = () => {
  notificationNextBefore = null; notificationReadThrough = null; notificationCount = 0;
  $('#notification-list').replaceChildren(); $('#notification-older').hidden = true;
  updateNotificationBadge(state?.notification_unread || 0);
  loadNotifications();
};
$('#notification-read-all').onclick = async () => {
  if (!state || notificationReadThrough === null) return;
  const epoch = workspaceEpoch, through = notificationReadThrough;
  const button = $('#notification-read-all'); button.disabled = true; let saved = false;
  try {
    const data = await api('/notifications/read-all', { through }); saved = true;
    if (epoch !== workspaceEpoch || !state) return;
    state.notification_unread = data.unreadCount; updateNotificationBadge(data.unreadCount);
    await refresh();
    if (epoch === workspaceEpoch && state) notify(`${data.changed} aviso(s) marcado(s) como lido(s).`);
  } catch(error) { if (epoch === workspaceEpoch) notify((saved ? 'Leitura salva, mas a atualização falhou. ' : '') + error.message); }
  finally { if (epoch === workspaceEpoch && state) updateNotificationBadge(state.notification_unread); }
};
$('#notification-older').onclick = () => { if (notificationNextBefore !== null) loadNotifications(notificationNextBefore); };
$('#notification-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-notification]'); if (!button) return;
  const epoch = workspaceEpoch; button.disabled = true; let marked = false;
  try {
    const data = await api(`/notifications/${Number(button.dataset.notification)}/read`, {}); marked = true;
    if (epoch !== workspaceEpoch || !state) return;
    updateNotificationBadge(data.unreadCount);
    await refresh();
    if (epoch !== workspaceEpoch || !state) return;
    if (button.dataset.openRequest) {
      const id = Number(button.dataset.openRequest);
      if (state.requests.some(r => r.id === id)) showRequest(id); else notify('Pedido não disponível nesta conta.');
    } else notify('Notificação marcada como lida.');
  } catch(error) { if (epoch === workspaceEpoch) notify((marked ? 'Aviso marcado como lido, mas a atualização falhou. ' : '') + error.message); }
  finally { button.disabled = false; }
});
function historyBusy(busy) {
  $('#history-submit').disabled = busy; $('#history-older').disabled = busy;
  if (busy) $('#history-list').setAttribute('aria-busy', 'true'); else $('#history-list').removeAttribute('aria-busy');
}
function resetHistory() {
  historyGeneration++; historyNextBefore = null; historyLoadedQuery = ''; historyCount = 0;
  $('#history-search').value = ''; $('#history-list').replaceChildren(); $('#history-results').textContent = ''; $('#history-error').textContent = ''; $('#history-older').hidden = true; historyBusy(false);
}
async function loadHistory(before = null) {
  if (!state || state.user.role !== 'admin') { resetHistory(); return; }
  const generation = ++historyGeneration, epoch = workspaceEpoch;
  const query = before === null ? $('#history-search').value.trim() : historyLoadedQuery;
  historyBusy(true); $('#history-error').textContent = ''; $('#history-results').textContent = 'Consultando histórico…';
  try {
    const params = new URLSearchParams({ q: query }); if (before !== null) params.set('before', before);
    const data = await api(`/history?${params}`);
    if (generation !== historyGeneration || epoch !== workspaceEpoch || !state) return;
    const html = data.history.map(h => `<article class="history-item"><span class="history-dot">${icon('clock')}</span><div>${escapeHTML(h.action)}<small>${escapeHTML(h.actor)} · ${date(h.created_at)}</small></div></article>`).join('');
    if (before === null) $('#history-list').innerHTML = html || '<div class="empty"><strong>Nenhum registro encontrado.</strong>Experimente outra busca ou consulte todas as ações.</div>';
    else $('#history-list').insertAdjacentHTML('beforeend', html);
    historyCount = before === null ? data.history.length : historyCount + data.history.length;
    historyLoadedQuery = query; historyNextBefore = data.nextBefore; $('#history-older').hidden = historyNextBefore === null;
    $('#history-results').textContent = `${historyCount} ${historyCount === 1 ? 'registro exibido' : 'registros exibidos'}${historyNextBefore !== null ? ' · Há registros anteriores.' : ''}`;
  } catch (error) {
    if (generation === historyGeneration && epoch === workspaceEpoch) { $('#history-error').textContent = error.message; $('#history-results').textContent = historyCount ? 'A consulta falhou. Os resultados anteriores foram mantidos.' : 'Não foi possível consultar o histórico.'; }
  } finally { if (generation === historyGeneration && epoch === workspaceEpoch) historyBusy(false); }
}
$('#history-search-form').onsubmit = event => { event.preventDefault(); loadHistory(); };
$('#history-clear').onclick = () => { $('#history-search').value = ''; loadHistory(); };
$('#history-older').onclick = () => { if (historyNextBefore !== null) loadHistory(historyNextBefore); };
$('#history-search').oninput = () => { historyGeneration++; historyBusy(false); $('#history-older').hidden = true; $('#history-error').textContent = ''; $('#history-results').textContent = 'Clique em Buscar ou pressione Enter para consultar.'; };
function clearPeopleFilters() {
  for (const id of ['people-search', 'people-sector-filter', 'people-role-filter', 'people-access-filter']) $(`#${id}`).value = '';
}
function renderPeople() {
  if (state.user.role !== 'admin') { $('#people-table').replaceChildren(); $('#people-results').textContent = ''; clearPeopleFilters(); return; }
  const people = filterPeople(state.users, { query: $('#people-search').value, sectorId: $('#people-sector-filter').value, role: $('#people-role-filter').value, access: $('#people-access-filter').value });
  $('#people-table').innerHTML = people.length ? `<table class="data-table people-table"><thead><tr><th scope="col">NOME</th><th scope="col">E-MAIL</th><th scope="col">SETOR</th><th scope="col">PERFIL</th><th scope="col">ACESSO</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${people.map(u => `<tr><td data-label="Nome"><strong>${escapeHTML(u.name)}</strong></td><td data-label="E-mail">${escapeHTML(u.email)}</td><td data-label="Setor">${escapeHTML(u.sector || 'Não informado')}</td><td data-label="Perfil">${u.role === 'admin' ? 'Administrador' : 'Colaborador'}</td><td data-label="Acesso"><span class="person-access ${u.active ? 'person-active' : 'person-inactive'}">${u.active ? 'Ativo' : 'Desativado'}</span></td><td data-label="Ações"><button type="button" class="row-open" data-person="${u.id}" aria-label="Editar ${escapeHTML(u.name)}">Editar ↗</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><strong>Nenhuma pessoa encontrada.</strong>Experimente outros filtros ou limpe a busca.</div>';
  $('#people-results').textContent = `${people.length} de ${state.users.length} ${state.users.length === 1 ? 'pessoa' : 'pessoas'}`;
}
$('#people-search').oninput = renderPeople;
for (const id of ['people-sector-filter', 'people-role-filter', 'people-access-filter']) $(`#${id}`).onchange = renderPeople;
$('#clear-people-filters').onclick = () => { clearPeopleFilters(); renderPeople(); $('#people-search').focus(); };
function clearSectorFilters() { $('#sector-search').value = ''; $('#sector-status-filter').value = ''; }
function renderSectors() {
  const admin = state.user.role === 'admin';
  const sectors = filterSectors(state.sectors, { query: $('#sector-search').value, status: $('#sector-status-filter').value });
  $('#sector-grid').innerHTML = sectors.map(s => `<article class="sector-card"><span class="sector-symbol">${icon('sectors')}</span><h2>${escapeHTML(s.name)}</h2><p class="sector-description">${escapeHTML(s.description || 'Descrição não informada.')}</p><p class="sector-meta">${s.active ? 'Ativo' : 'Desativado'}${admin ? ' · ' + state.users.filter(u => u.sector_id === s.id && u.active).length + ' pessoa(s) ativa(s)' : ''}</p>${admin ? `<button type="button" class="row-open sector-edit" data-sector="${s.id}" aria-label="Editar setor ${escapeHTML(s.name)}">Editar ↗</button>` : ''}</article>`).join('') || '<div class="empty sector-empty"><strong>Nenhum setor encontrado.</strong>Experimente outro termo ou limpe a busca.</div>';
  $('#sector-results').textContent = `${sectors.length} de ${state.sectors.length} ${state.sectors.length === 1 ? 'setor' : 'setores'}`;
}
$('#sector-search').oninput = renderSectors;
$('#sector-status-filter').onchange = renderSectors;
$('#clear-sector-filters').onclick = () => { clearSectorFilters(); renderSectors(); $('#sector-search').focus(); };
function renderSectorOverview() {
  const sectors = summarizeSectors(state.sectors, state.requests);
  $('#sector-overview-scope').textContent = state.user.role === 'admin' ? 'Pedidos da sua organização. Vencidos e urgentes contam somente os pendentes.' : 'Somente seus pedidos. Vencidos e urgentes contam somente os pendentes.';
  $('#sector-overview').innerHTML = sectors.length ? `<table class="data-table sector-overview-table"><caption class="sr-only">Resumo dos pedidos visíveis por setor</caption><thead><tr><th scope="col">SETOR</th><th scope="col">TOTAL</th><th scope="col">PENDENTES</th><th scope="col">VENCIDOS</th><th scope="col">URGENTES</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>${sectors.map(s => `<tr><th scope="row" data-label="Setor"><strong>${escapeHTML(s.name)}</strong>${s.active ? '' : '<small>Setor desativado</small>'}</th><td data-label="Total">${s.total}</td><td data-label="Pendentes">${s.pending}</td><td data-label="Vencidos"><span class="${s.overdue ? 'overview-warning' : ''}">${s.overdue}</span></td><td data-label="Urgentes"><span class="${s.urgent ? 'overview-warning' : ''}">${s.urgent}</span></td><td data-label="Ações"><button type="button" class="row-open" data-sector-requests="${s.id}" aria-label="Ver pedidos do setor ${escapeHTML(s.name)}">Ver pedidos ↗</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty"><strong>Ainda não há pedidos para resumir.</strong>Os setores com solicitações aparecerão aqui.</div>';
}
$('#sector-overview').addEventListener('click', event => {
  const button = event.target.closest('[data-sector-requests]'); if (!button) return;
  clearRequestFilters(); $('#sector-filter').value = button.dataset.sectorRequests;
  renderRequests(); setView('requests');
});
function renderRequests({ keepPage = false } = {}) {
  const search = $('#request-search').value.trim().toLocaleLowerCase('pt-BR'); const status = $('#status-filter').value;
  const overdueOnly = $('#deadline-filter').value === 'overdue';
  const assignment = state.user.role === 'admin' ? $('#assignment-filter').value : '';
  const sector = $('#sector-filter').value, priority = $('#priority-filter').value;
  const from = $('#created-from').value, to = $('#created-to').value;
  const error = periodError(from,to); $('#request-period-error').textContent = error;
  const activeOptions = [$('#deadline-filter').value, sector, priority, assignment, from, to, $('#request-order').value !== 'recent'].filter(Boolean).length;
  $('#request-advanced-count').textContent = activeOptions ? `· ${activeOptions} ${activeOptions === 1 ? 'ajuste ativo' : 'ajustes ativos'}` : '';
  if (error) $('#request-advanced').open = true;
  $('#export-requests').disabled = Boolean(error); $('#export-sector-summary').disabled = Boolean(error);
  const filtered = state.requests.filter(r => matchesRequestPeriod(r,from,to) && (!sector || r.sector_id === Number(sector)) && (!priority || r.priority === priority) && (!status || r.status === status) && (!overdueOnly || r.is_overdue) && (!assignment || (r.status === 'pendente' && (assignment === 'mine' ? r.assigned_to === state.user.id && r.assignee_available === 1 : !r.assigned_to || r.assignee_available !== 1))) && matchesRequestSearch(r, search));
  const ordered = orderRequests(filtered, $('#request-order').value), pageSize = 25;
  const pages = Math.max(1,Math.ceil(ordered.length/pageSize));
  requestPage = keepPage ? Math.min(Math.max(1,requestPage),pages) : 1;
  const offset = (requestPage-1)*pageSize;
  $('#all-requests').innerHTML = table(ordered.slice(offset,offset+pageSize));
  for (const nav of document.querySelectorAll('.request-pagination')) {
    nav.hidden = pages <= 1;
    nav.querySelector('[data-request-page=previous]').disabled = requestPage === 1;
    nav.querySelector('[data-request-page=next]').disabled = requestPage === pages;
    nav.querySelector('[data-request-page-label]').textContent = `Página ${requestPage} de ${pages}`;
  }
  $('#request-summary').hidden = Boolean(error);
  const counts = [
    ['Pendentes', filtered.filter(r => r.status === 'pendente').length, 'Aguardando decisão', 'clock'],
    ['Aprovadas', filtered.filter(r => r.status === 'aprovada').length, 'Pedidos autorizados', 'check'],
    ['Recusadas', filtered.filter(r => r.status === 'recusada').length, 'Pedidos não autorizados', 'document'],
    ['Pendentes vencidas', filtered.filter(r => r.status === 'pendente' && r.is_overdue).length, 'Incluídas nas pendentes', 'clock']
  ];
  $('#request-summary-metrics').innerHTML = counts.map(([label,value,subtitle,symbol]) => `<article class="metric"><span class="metric-symbol">${icon(symbol)}</span><div class="metric-content"><span class="metric-label">${label}</span><strong>${value}</strong><small>${subtitle}</small></div></article>`).join('');
  $('#request-results').textContent = filtered.length ? `Exibindo ${offset+1}–${Math.min(offset+pageSize,filtered.length)} de ${filtered.length} resultados · ${state.requests.length} solicitações no total` : `Nenhum resultado · ${state.requests.length} solicitações no total`;
}
$('#requests-view').addEventListener('click',event => {
  const button = event.target.closest('[data-request-page]');
  if (!button || button.disabled || !state) return;
  requestPage += button.dataset.requestPage === 'next' ? 1 : -1;
  renderRequests({keepPage:true});
});
$('#created-from').onchange = renderRequests; $('#created-to').onchange = renderRequests;
$('#request-search').oninput = renderRequests; $('#status-filter').onchange = renderRequests;
$('#deadline-filter').onchange = renderRequests;
$('#request-order').onchange = renderRequests;
$('#sector-filter').onchange = renderRequests; $('#priority-filter').onchange = renderRequests;
$('#clear-request-filters').onclick = () => { clearRequestFilters(); renderRequests(); };
$('#assignment-filter').onchange = () => { if ($('#assignment-filter').value) $('#status-filter').value = 'pendente'; renderRequests(); };
$('#overdue-alert').onclick = () => { clearRequestFilters(); $('#status-filter').value = 'pendente'; $('#deadline-filter').value = 'overdue'; $('#request-order').value = 'deadline'; renderRequests(); setView('requests'); };
async function exportRequests(summary = false) {
  const error = periodError($('#created-from').value,$('#created-to').value);
  if (error) { notify(error); return; }
  const button = $(summary ? '#export-sector-summary' : '#export-requests'), label = button.textContent; button.disabled = true; button.textContent = 'Preparando…';
  const params = new URLSearchParams({ q: $('#request-search').value.trim(), from: $('#created-from').value, to: $('#created-to').value, status: $('#status-filter').value, deadline: $('#deadline-filter').value, assignment: $('#assignment-filter').value, sector_id: $('#sector-filter').value, priority: $('#priority-filter').value, order: $('#request-order').value });
  try {
    const response = await fetch(`/api/requests/${summary ? 'summary' : 'export'}.csv?${params}`);
    if (!response.ok) {
      const data = await response.json();
      if (response.status === 401) { state = null; $('#modal').close(); showAuth(); }
      throw new Error(data.error || 'Não foi possível exportar.');
    }
    const file = await response.blob();
    const url = URL.createObjectURL(file); const link = document.createElement('a');
    link.href = url; link.download = summary ? 'cosmos-resumo-setores.csv' : 'cosmos-solicitacoes.csv'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify('Arquivo preparado para download.');
  } catch (error) { notify(error.message); }
  finally { button.disabled = Boolean(periodError($('#created-from').value,$('#created-to').value)); button.textContent = label; }
}
$('#export-requests').onclick = () => exportRequests();
$('#export-sector-summary').onclick = () => exportRequests(true);

$('#refresh-workspace').onclick = async () => {
  try { await refresh(); }
  catch (error) { if (state) notify('Não foi possível atualizar. Os dados anteriores foram mantidos. ' + error.message); else $('#auth-error').textContent = error.message; }
};
async function refresh() {
  const sequence = ++refreshSequence, epoch = workspaceEpoch;
  const button = $('#refresh-workspace'); button.disabled = true; button.textContent = 'Atualizando…'; button.setAttribute('aria-busy', 'true');
  try {
    const nextState = await api('/workspace');
    if (epoch !== workspaceEpoch || sequence !== refreshSequence) return;
    state = nextState; notificationGeneration++; updateNotificationBadge(state.notification_unread); $('#auth').hidden = true; $('#workspace').hidden = false;
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
    $('#recent-requests').innerHTML = table(state.requests.slice(0, 5)); renderRequests(); renderSectorOverview();
    renderSectors();
    const selectedPeopleSector = $('#people-sector-filter').value;
    $('#people-sector-filter').innerHTML = '<option value="">Todos os setores</option>' + state.sectors.map(s => `<option value="${s.id}">${escapeHTML(s.name)}${s.active ? '' : ' (desativado)'}</option>`).join('');
    $('#people-sector-filter').value = state.sectors.some(s => String(s.id) === selectedPeopleSector) ? selectedPeopleSector : '';
    renderPeople();
    if (!admin) resetHistory();
    await setView(currentView);
    if (epoch !== workspaceEpoch || sequence !== refreshSequence) return;
    $('#workspace-updated').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    if (pendingLinkedRequest !== null) {
      const raw = pendingLinkedRequest; pendingLinkedRequest = null;
      const id = Number(raw);
      if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) notify('O link da solicitação é inválido.');
      else if (!state.requests.some(request => request.id === id)) notify('Pedido não disponível nesta conta.');
      else { setView('requests'); showRequest(id); }
    }

  } finally {
    if (epoch === workspaceEpoch && sequence === refreshSequence) { button.disabled = false; button.textContent = 'Atualizar dados ↻'; button.removeAttribute('aria-busy'); }
  }
}
$('#workspace').addEventListener('click', event => { const button = event.target.closest('[data-request]'); if (button) showRequest(Number(button.dataset.request)); const person = event.target.closest('[data-person]'); if (person) editUserForm(Number(person.dataset.person)); const sector = event.target.closest('[data-sector]'); if (sector) editSectorForm(Number(sector.dataset.sector)); });
$('#close-modal').onclick = () => $('#modal').close();
function openModal(title, html) { $('#modal').classList.remove('request-dialog'); $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; if (!$('#modal').open) $('#modal').showModal(); }
function showGuide() {
  const admin = state.user.role === 'admin';
  openModal('Seu caminho no COSMOS', `<p class="guide-intro">Um pedido de cada vez. Veja como é simples acompanhar sua rotina por aqui.</p><ol class="guide-steps"><li><span>1</span><div><h3>Conte o que você precisa</h3><p>Crie uma solicitação com título, setor, prioridade e uma justificativa clara.</p></div></li><li><span>2</span><div><h3>Acompanhe a decisão</h3><p>Abra o pedido em Solicitações para ver a situação e o parecer. ${admin ? 'Como administrador, você também pode avaliar os pedidos de outras pessoas.' : 'Os administradores da organização analisam os pedidos.'}</p></div></li><li><span>3</span><div><h3>Mantenha a conversa por perto</h3><p>Use os comentários do pedido para esclarecer dúvidas, inclusive depois da decisão.</p></div></li></ol>${admin ? '<p class="hint">Em Pessoas e Setores você organiza a equipe. Pedidos próprios precisam ser avaliados por outro administrador.</p>' : '<p class="hint">Você acompanha seus próprios pedidos. Para atualizar seu cadastro, procure um administrador.</p>'}<div class="form-actions"><button type="button" class="secondary" id="guide-browse">Ver solicitações</button><button type="button" class="primary" id="guide-new">Criar meu pedido ${icon('arrow')}</button></div>`);
  $('#guide-browse').onclick = () => { $('#modal').close(); setView('requests'); };
  $('#guide-new').onclick = () => { $('#modal').close(); requestForm(); };
}
function sectorOptions() { return state.sectors.filter(s => s.active).map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join(''); }
function returnToRequest(id) {
  if (state?.requests.some(request => request.id === id)) showRequest(id);
  else notify('Pedido não disponível nesta conta. Atualize os dados.');
}
function formModal(title, fields, endpoint, convert = data => data, success = 'Cadastro realizado.', returnRequestId = null) {
  openModal(title, `<form id="modal-form">${fields}<p class="error" id="modal-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary" id="cancel-form">${returnRequestId ? '← Voltar ao pedido' : 'Cancelar'}</button><button class="primary" type="submit">Salvar ↗</button></div></form>`);
  $('#cancel-form').onclick = () => { if (returnRequestId) returnToRequest(returnRequestId); else $('#modal').close(); };
  $('#modal-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('[type=submit]'), cancel = form.querySelector('#cancel-form'), epoch = workspaceEpoch;
    submit.disabled = true; cancel.disabled = true; form.querySelector('#modal-error').textContent = '';
    let saved = false;
    try {
      await api(endpoint, convert(Object.fromEntries(new FormData(form)))); saved = true;
      if (epoch !== workspaceEpoch || !state) return;
      const returnAfterSave = form.isConnected && $('#modal').open;
      if (returnAfterSave) $('#modal').close();
      await refresh();
      if (epoch !== workspaceEpoch || !state) return;
      if (returnRequestId && returnAfterSave && !$('#modal').open) returnToRequest(returnRequestId);
      notify(success);
    } catch (error) {
      if (epoch !== workspaceEpoch) return;
      const message = (saved ? `${success} A atualização dos dados falhou. Use Atualizar dados antes de continuar. ` : '') + error.message;
      if (form.isConnected && $('#modal').open) form.querySelector('#modal-error').textContent = message;
      else notify(message);
    } finally { submit.disabled = false; cancel.disabled = false; }
  };
}
function requestForm(template = null) {
  if (template && (!state || template.user_id !== state.user.id)) return;
  if (!state.sectors.some(s => s.active)) { notify('Peça ao administrador para ativar ou cadastrar um setor.'); return; }
  formModal(template ? 'Nova solicitação a partir de modelo' : 'Nova solicitação', `${template ? '<p class="hint">Revise os dados abaixo. Um novo pedido será criado somente ao salvar, com novo protocolo e análise independente.</p>' : ''}<label>Título<input name="title" required maxlength="160" placeholder="Ex.: Aquisição de material de escritório"></label><label>Setor responsável<select name="sector_id" required>${sectorOptions()}</select></label><label>Prioridade<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label><label>Descrição e justificativa<textarea name="description" required maxlength="5000" placeholder="Descreva o que você precisa e por quê."></textarea></label>`, '/requests', data => ({ ...data, sector_id: Number(data.sector_id) }), 'Solicitação enviada para avaliação.');
  if (template) {
    const form = $('#modal-form');
    form.elements.title.value = template.title;
    form.elements.description.value = template.description;
    form.elements.priority.value = template.priority;
    const available = state.sectors.some(s => s.active && s.id === template.sector_id);
    if (available) form.elements.sector_id.value = String(template.sector_id);
    else {
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Escolha um setor ativo'; placeholder.disabled = true; placeholder.selected = true;
      form.elements.sector_id.prepend(placeholder);
      const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'O setor do pedido original está desativado. Escolha um setor ativo para continuar.';
      form.elements.sector_id.closest('label').after(hint);
    }
  }
}
function editRequestForm(request) {
  if (request.user_id !== state.user.id || request.status !== 'pendente') return;
  formModal('Editar meu pedido', `<p class="hint">Corrija o título e a justificativa. A edição será registrada nas movimentações. Setor, prioridade, prazo e responsável permanecem como estão.</p><label>Título<input name="title" required maxlength="160" value="${escapeHTML(request.title)}"></label><label>Descrição e justificativa<textarea name="description" required maxlength="5000">${escapeHTML(request.description)}</textarea></label>`, `/requests/${request.id}/edit`, data => ({ ...data, expected: { title: request.title, description: request.description } }), 'Pedido atualizado.', request.id);
}
$('#organization-settings').onclick = () => {
  if (!state || state.user.role !== 'admin') return;
  const organization = state.organization;
  formModal('Editar organização', `<label>Nome da organização<input name="name" required maxlength="160" autocomplete="organization" value="${escapeHTML(organization.name)}"></label><label>Natureza<select name="type"><option value="privada" ${organization.type === 'privada' ? 'selected' : ''}>Empresa privada</option><option value="publica" ${organization.type === 'publica' ? 'selected' : ''}>Órgão ou entidade pública</option></select></label><p class="hint">O nome atualizado aparecerá no sistema e nas novas impressões dos pedidos. Solicitações, pessoas e setores serão preservados. As mudanças ficam registradas no histórico.</p>`, '/organization', data => ({name:data.name,type:data.type}), 'Organização atualizada.');
};
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
  $('#request-history-panel').append(section);
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
  $('#request-comments-panel').append(section);
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
  formModal(`Responsável · COS-${String(request.id).padStart(5, '0')}`, `<label>Administrador responsável<select name="assigned_to">${options}</select></label><p class="hint">Escolha um administrador ativo da organização, diferente do solicitante. A atribuição organiza o acompanhamento; os administradores continuam podendo avaliar pedidos de outras pessoas. Selecione Sem responsável para remover o vínculo.</p>${!candidates.length ? '<p class="hint">Nenhum administrador elegível. Cadastre outro administrador em Pessoas para atribuir este pedido.</p>' : ''}`, `/requests/${request.id}/assignee`, data => ({ assigned_to: data.assigned_to ? Number(data.assigned_to) : null }), 'Responsável atualizado.', request.id);
}
function deadlineForm(request) {
  formModal(`Prazo · COS-${String(request.id).padStart(5, '0')}`, `<label>Data limite<input name="due_date" type="date" min="1000-01-01" max="9999-12-31" value="${escapeHTML(request.due_date || '')}"></label><p class="hint">Deixe vazio para remover o prazo. O pedido vence após o fim da data escolhida, no horário de Brasília. Datas passadas são aceitas e aparecem como vencidas enquanto o pedido estiver pendente.</p>`, `/requests/${request.id}/deadline`, data => ({ due_date: data.due_date || null }), 'Prazo atualizado.', request.id);
}
function showRequest(id) {
  const r = state.requests.find(r => r.id === id); if (!r) return;
  const canDecide = state.user.role === 'admin' && r.status === 'pendente' && r.user_id !== state.user.id;
  const own = r.user_id === state.user.id, pending = r.status === 'pendente', manager = state.user.role === 'admin' && pending;
  openModal(`Solicitação COS-${String(id).padStart(5, '0')}`, `
    <div class="request-overview">${pill(r.status)}<h3>${escapeHTML(r.title)}</h3><p>${escapeHTML(r.author)} <span>·</span> ${date(r.created_at)}</p></div>
    <div class="request-toolbar"><button type="button" class="secondary" id="copy-request-protocol">Copiar protocolo</button><button type="button" class="secondary" id="copy-request-link">Copiar link</button>${own && pending ? '<button type="button" class="secondary" id="edit-own-request">Editar pedido</button>' : ''}<a class="secondary" href="/api/requests/${id}/print" target="_blank" rel="noopener">Imprimir / PDF ↗</a>${own ? '<button type="button" class="text-button" id="reuse-own-request">Usar como modelo</button>' : ''}</div>
    <p id="copy-protocol-status" class="copy-protocol-status" role="status" aria-live="polite"></p><div id="copy-protocol-fallback" hidden><label>Texto para copiar<input id="copy-protocol-value" type="text" readonly value="COS-${String(id).padStart(5, '0')}" aria-describedby="copy-protocol-status"></label></div>
    <div class="request-tabs" role="tablist" aria-label="Informações da solicitação">${[['details','Detalhes'],['comments','Comentários'],['history','Movimentações']].map(([key,label],i)=>`<button type="button" role="tab" id="request-tab-${key}" aria-controls="request-${key}-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-request-tab="${key}">${label}</button>`).join('')}</div>
    <section id="request-details-panel" class="request-tab-panel" role="tabpanel" aria-labelledby="request-tab-details" tabindex="0">
      <dl class="request-facts"><div><dt>Setor</dt><dd>${escapeHTML(r.sector)}</dd></div><div><dt>Prioridade</dt><dd><span class="priority ${r.priority}">${escapeHTML(r.priority[0].toUpperCase()+r.priority.slice(1))}</span></dd></div><div><dt>Prazo</dt><dd>${deadlineBadge(r)}${manager ? '<button type="button" class="text-button" id="edit-deadline" aria-label="Alterar prazo do pedido">Alterar</button>' : ''}</dd></div><div><dt>Responsável pela análise</dt><dd>${assigneeBadge(r)}${manager ? '<button type="button" class="text-button" id="edit-assignee" aria-label="Alterar responsável pela análise">Alterar</button>' : ''}</dd></div></dl>
      <section class="request-description"><h4>Descrição e justificativa</h4><p>${escapeHTML(r.description)}</p></section>
      ${r.decision ? `<section class="decision-note"><strong>${statusName[r.status]} por ${escapeHTML(r.reviewer)}</strong><small>${date(r.decided_at)}</small><p>${escapeHTML(r.decision)}</p></section>` : ''}
      ${own && state.user.role === 'admin' && pending ? '<p class="request-info">Seu pedido será avaliado por outro administrador. Você pode cadastrá-lo em Pessoas.</p>' : ''}
      ${canDecide ? '<form id="decision-form"><h4>Registrar decisão</h4><label>Parecer<textarea name="decision" required maxlength="2000" placeholder="Explique o motivo da decisão."></textarea></label><p class="error" id="decision-error" role="alert"></p><div class="form-actions"><button type="submit" name="status" value="recusada" class="secondary">Recusar</button><button type="submit" name="status" value="aprovada" class="primary">Aprovar pedido</button></div></form>' : ''}
    </section>
    <section id="request-comments-panel" class="request-tab-panel" role="tabpanel" aria-labelledby="request-tab-comments" tabindex="0" hidden></section>
    <section id="request-history-panel" class="request-tab-panel" role="tabpanel" aria-labelledby="request-tab-history" tabindex="0" hidden></section>`);
  $('#modal').classList.add('request-dialog');
  async function copyRequestReference(event, link = false) {
    const button = event.currentTarget, epoch = workspaceEpoch, protocol = `COS-${String(id).padStart(5,'0')}`;
    const url = new URL('/', location.origin); url.searchParams.set('pedido', String(id));
    const value = link ? url.href : protocol;
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Cópia automática indisponível.');
      await navigator.clipboard.writeText(value);
      if (epoch === workspaceEpoch && button.isConnected) {
        $('#copy-protocol-fallback').hidden = true;
        $('#copy-protocol-status').textContent = link ? 'Link do pedido copiado. O acesso exige login e permissão.' : `Protocolo ${protocol} copiado.`;
      }
    } catch {
      if (epoch === workspaceEpoch && button.isConnected) {
        $('#copy-protocol-status').textContent = 'A cópia automática não está disponível. Copie o texto selecionado abaixo.';
        $('#copy-protocol-fallback').hidden = false;
        $('#copy-protocol-value').value = value;
        $('#copy-protocol-value').focus(); $('#copy-protocol-value').select();
      }
    } finally { button.disabled = false; }
  }
  $('#copy-request-protocol').onclick = event => copyRequestReference(event);
  $('#copy-request-link').onclick = event => copyRequestReference(event,true);

  const tabs = [...$('#modal').querySelectorAll('[data-request-tab]')];
  function selectTab(tab) {
    for (const item of tabs) { const selected = item === tab; item.setAttribute('aria-selected',String(selected)); item.tabIndex = selected ? 0 : -1; $(`#request-${item.dataset.requestTab}-panel`).hidden = !selected; }
  }
  for (const tab of tabs) {
    tab.onclick = () => selectTab(tab);
    tab.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index+(event.key === 'ArrowRight' ? 1 : -1)+tabs.length)%tabs.length;
      selectTab(tabs[next]); tabs[next].focus();
    };
  }
  if ($('#reuse-own-request')) $('#reuse-own-request').onclick = () => requestForm(r);
  if ($('#edit-own-request')) $('#edit-own-request').onclick = () => editRequestForm(r);
  if ($('#edit-deadline')) $('#edit-deadline').onclick = () => deadlineForm(r);
  if ($('#edit-assignee')) $('#edit-assignee').onclick = () => assigneeForm(r);
  mountComments(id);
  mountRequestHistory(id);
  if (canDecide) $('#decision-form').onsubmit = async event => {
    event.preventDefault(); const buttons = event.target.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
    try { await api(`/requests/${id}/decision`, { decision: new FormData(event.target).get('decision'), status: event.submitter.value, expected: { title: r.title, description: r.description } }); $('#modal').close(); await refresh(); notify('Decisão registrada.'); }
    catch (error) { if ($('#decision-error')) $('#decision-error').textContent = error.message; else notify(error.message); } finally { buttons.forEach(b => b.disabled = false); }
  };
}
const initialRefreshSequence = refreshSequence + 1;
refresh().catch(error => { if (refreshSequence !== initialRefreshSequence) return; showAuth(); if (!error.message.includes('Entre na sua conta')) notify(error.message); });

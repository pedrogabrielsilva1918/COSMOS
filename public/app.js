'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const statusName = { pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada' };
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
function showAuth() { $('#workspace').hidden = true; $('#auth').hidden = false; }
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
  dashboard: ['Visão geral', 'TUDO EM SEU LUGAR', 'Acompanhe sua organização e faça o trabalho avançar.', '+ Nova solicitação'],
  requests: ['Solicitações', 'DO PEDIDO À DECISÃO', 'Crie, acompanhe e consulte as solicitações.', '+ Nova solicitação'],
  sectors: ['Setores', 'UMA ESTRUTURA CONECTADA', 'Organize as áreas que fazem sua organização acontecer.', '+ Novo setor'],
  people: ['Pessoas', 'QUEM FAZ ACONTECER', 'Cadastre sua equipe e defina os perfis de acesso.', '+ Nova pessoa'],
  history: ['Histórico', 'CADA ETAPA REGISTRADA', 'Consulte as últimas 50 ações da sua organização.', null]
};
function setView(view) {
  if (!state || !viewInfo[view] || (['people', 'history'].includes(view) && state.user.role !== 'admin')) return;
  currentView = view;
  for (const key of Object.keys(viewInfo)) $(`#${key}-view`).hidden = key !== view;
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === view);
  const [title, kicker, description, action] = viewInfo[view];
  $('#page-title').textContent = title + '.'; $('#breadcrumb').textContent = title; $('#page-kicker').textContent = kicker; $('#page-description').textContent = description;
  $('#main-action').textContent = action || ''; $('#main-action').hidden = !action || (view === 'sectors' && state.user.role !== 'admin');
}
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => setView(button.dataset.view);
$('#see-all').onclick = () => setView('requests');
$('#sidebar-new').onclick = () => requestForm();
$('#main-action').onclick = () => ({ sectors: sectorForm, people: userForm }[currentView] || requestForm)();
const pill = status => `<span class="pill ${status}">${statusName[status]}</span>`;
function table(requests) {
  if (!requests.length) return '<div class="empty"><strong>Nenhuma solicitação por aqui.</strong>Crie uma solicitação ou ajuste os filtros para começar.</div>';
  return `<table class="data-table"><thead><tr><th>SOLICITAÇÃO</th><th>SETOR</th><th>SITUAÇÃO</th><th>PRIORIDADE</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${requests.map(r => `<tr><td><span class="request-title">${escapeHTML(r.title)}</span><span class="request-id">COS-${String(r.id).padStart(5, '0')} · ${escapeHTML(r.author)}</span></td><td>${escapeHTML(r.sector)}</td><td>${pill(r.status)}</td><td><span class="priority ${r.priority}">${escapeHTML(r.priority[0].toUpperCase() + r.priority.slice(1))}</span></td><td><button class="row-open" data-request="${r.id}" aria-label="Abrir solicitação ${r.id}">Abrir ↗</button></td></tr>`).join('')}</tbody></table>`;
}
function renderRequests() {
  const search = $('#request-search').value.trim().toLocaleLowerCase('pt-BR'); const status = $('#status-filter').value;
  $('#all-requests').innerHTML = table(state.requests.filter(r => (!status || r.status === status) && `${r.title} COS-${String(r.id).padStart(5, '0')}`.toLocaleLowerCase('pt-BR').includes(search)));
}
$('#request-search').oninput = renderRequests; $('#status-filter').onchange = renderRequests;
async function refresh() {
  state = await api('/workspace'); $('#auth').hidden = true; $('#workspace').hidden = false;
  const admin = state.user.role === 'admin';
  for (const el of document.querySelectorAll('[data-admin]')) el.hidden = !admin;
  $('#org-name').textContent = state.organization.name; $('#org-type').textContent = state.organization.type === 'publica' ? 'Organização pública' : 'Empresa privada';
  $('#account-name').textContent = state.user.name; $('#account-role').textContent = admin ? 'Administrador' : 'Colaborador';
  $('#avatar').textContent = state.user.name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  $('#today').textContent = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  $('#greeting').textContent = `Olá, ${state.user.name.split(' ')[0]}. Vamos avançar?`;
  const pending = state.requests.filter(r => r.status === 'pendente').length; $('#pending-count').textContent = pending;
  const metrics = [['Total de solicitações', state.requests.length, 'Todas as situações', '▤'], ['Aguardando decisão', pending, 'Solicitações pendentes', '◷'], ['Aprovadas', state.requests.filter(r => r.status === 'aprovada').length, 'Pedidos autorizados', '↗'], ['Setores ativos', state.sectors.length, 'Áreas da organização', '▦']];
  $('#metrics').innerHTML = metrics.map(([label, value, subtitle, symbol]) => `<article class="metric"><div class="metric-top">${label}<span class="metric-symbol">${symbol}</span></div><strong>${String(value).padStart(2, '0')}</strong><small>${subtitle}</small></article>`).join('');
  $('#recent-requests').innerHTML = table(state.requests.slice(0, 5)); renderRequests();
  $('#sector-grid').innerHTML = state.sectors.map(s => `<article class="sector-card"><span>▦</span><h2>${escapeHTML(s.name)}</h2><p>${admin ? state.users.filter(u => u.sector_id === s.id && u.active).length + ' pessoa(s) ativa(s) vinculada(s)' : 'Setor da organização'}</p></article>`).join('');
  $('#people-table').innerHTML = `<table class="data-table"><thead><tr><th>NOME</th><th>E-MAIL</th><th>SETOR</th><th>PERFIL</th><th>ACESSO</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>${state.users.map(u => `<tr><td>${escapeHTML(u.name)}</td><td>${escapeHTML(u.email)}</td><td>${escapeHTML(u.sector)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Colaborador'}</td><td>${u.active ? 'Ativo' : 'Desativado'}</td><td><button class="row-open" data-person="${u.id}" aria-label="Editar ${escapeHTML(u.name)}">Editar ↗</button></td></tr>`).join('')}</tbody></table>`;
  $('#history-list').innerHTML = state.history.map(h => `<article class="history-item"><span class="history-dot">◷</span><div>${escapeHTML(h.action)}<small>${escapeHTML(h.actor)} · ${date(h.created_at)}</small></div></article>`).join('') || '<div class="empty">Nenhuma movimentação registrada.</div>';
  setView(currentView);
}
$('#workspace').addEventListener('click', event => { const button = event.target.closest('[data-request]'); if (button) showRequest(Number(button.dataset.request)); const person = event.target.closest('[data-person]'); if (person) editUserForm(Number(person.dataset.person)); });
$('#close-modal').onclick = () => $('#modal').close();
function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; if (!$('#modal').open) $('#modal').showModal(); }
function sectorOptions() { return state.sectors.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join(''); }
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
  formModal('Nova solicitação', `<label>Título<input name="title" required maxlength="160" placeholder="Ex.: Aquisição de material de escritório"></label><label>Setor responsável<select name="sector_id" required>${sectorOptions()}</select></label><label>Prioridade<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label><label>Descrição e justificativa<textarea name="description" required maxlength="5000" placeholder="Descreva o que você precisa e por quê."></textarea></label>`, '/requests', data => ({ ...data, sector_id: Number(data.sector_id) }), 'Solicitação enviada para avaliação.');
}
function sectorForm() { formModal('Novo setor', '<label>Nome do setor<input name="name" required maxlength="120" placeholder="Ex.: Recursos Humanos"></label>', '/sectors'); }
function userForm() {
  formModal('Cadastrar pessoa', `<label>Nome completo<input name="name" required maxlength="120" autocomplete="name"></label><label>E-mail<input name="email" required type="email" maxlength="200" autocomplete="off"></label><label>Senha inicial<input name="password" required type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><p class="hint">Use pelo menos 12 caracteres. Entregue as credenciais à pessoa por um canal seguro.</p><label>Setor<select name="sector_id" required>${sectorOptions()}</select></label><label>Perfil de acesso<select name="role"><option value="colaborador">Colaborador — cria e acompanha seus pedidos</option><option value="admin">Administrador — gerencia equipe e aprova pedidos</option></select></label>`, '/users', data => ({ ...data, sector_id: Number(data.sector_id) }));
}
function editUserForm(id) {
  const person = state.users.find(user => user.id === id);
  if (!person || state.user.role !== 'admin') return;
  const self = id === state.user.id;
  formModal('Editar pessoa', `<p class="detail-meta">${escapeHTML(person.email)}</p><label>Nome completo<input name="name" required maxlength="120" value="${escapeHTML(person.name)}"></label><label>Setor<select name="sector_id" required>${state.sectors.map(s => `<option value="${s.id}" ${s.id === person.sector_id ? 'selected' : ''}>${escapeHTML(s.name)}</option>`).join('')}</select></label><label>Perfil de acesso<select name="role" ${self ? 'disabled' : ''}><option value="colaborador" ${person.role === 'colaborador' ? 'selected' : ''}>Colaborador</option><option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label><label>Acesso ao COSMOS<select name="active" ${self ? 'disabled' : ''}><option value="true" ${person.active ? 'selected' : ''}>Ativo</option><option value="false" ${!person.active ? 'selected' : ''}>Desativado</option></select></label><p class="hint">${self ? 'Outro administrador deve alterar seu perfil ou desativar seu acesso.' : 'Desativar bloqueia novos logins e encerra as sessões. Alterar o perfil também exige novo login. Solicitações e histórico são preservados. Reativar não recupera sessões anteriores.'}</p>`, `/users/${id}`, data => ({ name: data.name, sector_id: Number(data.sector_id), role: self ? person.role : data.role, active: self ? Boolean(person.active) : data.active === 'true' }), 'Pessoa atualizada.');
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
function showRequest(id) {
  const r = state.requests.find(r => r.id === id); if (!r) return;
  const canDecide = state.user.role === 'admin' && r.status === 'pendente' && r.user_id !== state.user.id;
  openModal(`Solicitação COS-${String(id).padStart(5, '0')}`, `${pill(r.status)}<h3 class="detail-title">${escapeHTML(r.title)}</h3><p class="detail-meta">Solicitante: ${escapeHTML(r.author)}<br>Setor: ${escapeHTML(r.sector)} · Prioridade: ${escapeHTML(r.priority)}<br>Enviada em ${date(r.created_at)}</p><div class="detail-description">${escapeHTML(r.description)}</div>${r.decision ? `<div class="decision-note"><strong>Decisão de ${escapeHTML(r.reviewer)} · ${date(r.decided_at)}</strong><p>${escapeHTML(r.decision)}</p></div>` : ''}${r.user_id === state.user.id && state.user.role === 'admin' && r.status === 'pendente' ? '<p class="hint">Outro administrador deve avaliar seu pedido. Você pode cadastrá-lo em Pessoas.</p>' : ''}${canDecide ? '<form id="decision-form"><label>Parecer<textarea name="decision" required maxlength="2000" placeholder="Registre o motivo da decisão."></textarea></label><p class="error" id="decision-error" role="alert"></p><div class="form-actions"><button type="submit" name="status" value="recusada" class="primary danger">Recusar</button><button type="submit" name="status" value="aprovada" class="primary">Aprovar ↗</button></div></form>' : ''}`);
  mountComments(id);
  if (canDecide) $('#decision-form').onsubmit = async event => {
    event.preventDefault(); const buttons = event.target.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
    try { await api(`/requests/${id}/decision`, { decision: new FormData(event.target).get('decision'), status: event.submitter.value }); $('#modal').close(); await refresh(); notify('Decisão registrada.'); }
    catch (error) { if ($('#decision-error')) $('#decision-error').textContent = error.message; else notify(error.message); } finally { buttons.forEach(b => b.disabled = false); }
  };
}
refresh().catch(error => { showAuth(); if (!error.message.includes('Entre na sua conta')) notify(error.message); });

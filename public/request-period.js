const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' });
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
export function periodError(from = '', to = '') {
  if ((from && !validDay(from)) || (to && !validDay(to))) return 'Informe datas válidas para o período.';
  if (from && to && from > to) return 'A data inicial deve ser anterior ou igual à data final.';
  return '';
}
export function matchesRequestPeriod(request, from = '', to = '') {
  if (periodError(from,to)) return false;
  if (!from && !to) return true;
  const date = new Date(request.created_at);
  if (!Number.isFinite(date.getTime())) return false;
  const parts = dayFormat.formatToParts(date), get = type => parts.find(p => p.type === type).value;
  const day = `${get('year').padStart(4,'0')}-${get('month')}-${get('day')}`;
  return (!from || day >= from) && (!to || day <= to);
}

export function periodPreset(preset, now = new Date()) {
  if (!['today','week','month'].includes(preset)) throw new TypeError('Atalho de período inválido.');
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Data atual inválida.');
  const parts = dayFormat.formatToParts(date), get = type => parts.find(p => p.type === type).value;
  const to = `${get('year').padStart(4,'0')}-${get('month')}-${get('day')}`;
  if (preset === 'today') return {from:to,to};
  if (preset === 'month') return {from:to.slice(0,8)+'01',to};
  // Subtrai dias no calendário, sem depender do fuso ou do horário de verão do navegador.
  const from = new Date(`${to}T12:00:00Z`); from.setUTCDate(from.getUTCDate()-6);
  return {from:from.toISOString().slice(0,10),to};
}

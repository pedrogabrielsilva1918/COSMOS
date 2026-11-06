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

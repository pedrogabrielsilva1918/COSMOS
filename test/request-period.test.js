import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRequestPeriod, periodError, periodPreset } from '../public/request-period.js';
test('período inclui todo o dia de Brasília e permite limites abertos',()=>{
  const match=(created_at,from='2026-11-06',to='2026-11-06')=>matchesRequestPeriod({created_at},from,to);
  assert.equal(match('2026-11-06T02:59:59.999Z'),false);
  assert.equal(match('2026-11-06T03:00:00.000Z'),true);
  assert.equal(match('2026-11-07T02:59:59.999Z'),true);
  assert.equal(match('2026-11-07T03:00:00.000Z'),false);
  assert.equal(match('2026-11-08T03:00:00Z','2026-11-06',''),true);
  assert.equal(match('2026-11-01T03:00:00Z','','2026-11-06'),true);
  assert.equal(match('invalid'),false);
  assert.equal(matchesRequestPeriod({created_at:'invalid'}),true);
});
test('período rejeita datas inexistentes e invertidas',()=>{
  for(const value of ['2026-02-29','2026-04-31','0000-01-01','2026-1-01','abc','2026-13-01']) assert.ok(periodError(value,''),value);
  assert.equal(periodError('2024-02-29','2024-02-29'),'');
  assert.ok(periodError('2026-11-07','2026-11-06'));
  assert.equal(matchesRequestPeriod({created_at:'2026-11-06T12:00:00Z'},'2026-11-07','2026-11-06'),false);
});

test('atalhos usam o calendário de Brasília nas viradas de dia, ano e ano bissexto',()=>{
  assert.deepEqual(periodPreset('today',new Date('2026-11-06T02:00:00Z')),{from:'2026-11-05',to:'2026-11-05'});
  assert.deepEqual(periodPreset('week',new Date('2026-01-03T12:00:00Z')),{from:'2025-12-28',to:'2026-01-03'});
  assert.deepEqual(periodPreset('week',new Date('2024-03-02T12:00:00Z')),{from:'2024-02-25',to:'2024-03-02'});
  assert.deepEqual(periodPreset('month',new Date('2024-03-01T01:00:00Z')),{from:'2024-02-01',to:'2024-02-29'});
  assert.throws(()=>periodPreset('invalid'),TypeError);
  assert.throws(()=>periodPreset('today',new Date('invalid')),RangeError);
});

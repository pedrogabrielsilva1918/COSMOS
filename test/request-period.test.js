import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRequestPeriod, periodError } from '../public/request-period.js';
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

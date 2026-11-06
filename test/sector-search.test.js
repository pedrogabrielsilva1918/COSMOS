import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSectors } from '../public/sector-search.js';

const sectors = [
  { id: 1, name: 'Jurídico', description: 'Orienta sobre contratos e questões jurídicas.', active: 1 },
  { id: 2, name: 'Compras e Licitações', description: 'Acompanha aquisições e contratos.', active: 1 },
  { id: 3, name: 'Documentação antiga', description: 'Consulta de arquivos históricos.', active: 0 },
  { id: 4, name: 'Suporte', description: '', active: 1 },
];

test('busca de setores encontra nomes e descrições sem acentos ou ordem fixa de palavras', () => {
  const ids=query=>filterSectors(sectors,{query}).map(s=>s.id);
  assert.deepEqual(ids('  JURIDICO  '),[1]);
  assert.deepEqual(ids('juri\u0301dico'),[1]);
  assert.deepEqual(ids('CONTRATOS'),[1,2]);
  assert.deepEqual(ids(' contratos   compras\t'),[2]);
  assert.deepEqual(ids('historicos arquivos'),[3]);
  assert.deepEqual(ids('compras jurídicos'),[]);
  assert.deepEqual(ids('<script>'),[]);
});

test('filtro de situação combina com busca sem alterar setores ou sua ordem', () => {
  const original=structuredClone(sectors);
  assert.deepEqual(filterSectors(sectors,{status:'active'}).map(s=>s.id),[1,2,4]);
  assert.deepEqual(filterSectors(sectors,{status:'inactive'}).map(s=>s.id),[3]);
  assert.deepEqual(filterSectors(sectors,{query:'contratos',status:'inactive'}),[]);
  assert.deepEqual(filterSectors(sectors,{query:'documentacao',status:'inactive'}).map(s=>s.id),[3]);
  assert.deepEqual(filterSectors(sectors,{query:'\n\t '}),sectors);
  assert.deepEqual(filterSectors([],{query:'qualquer'}),[]);
  assert.deepEqual(sectors,original);
  assert.notEqual(filterSectors(sectors),sectors);
  assert.throws(()=>filterSectors(sectors,{status:'invalid'}),/Filtro de setor inválido/);
});

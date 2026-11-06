import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPeople } from '../public/people-search.js';

const people=[
  {id:1,name:'José da Silva',email:'jose@empresa.com',sector_id:1,sector:'Administração',role:'admin',active:1},
  {id:2,name:'Maria Souza',email:'maria@empresa.com',sector_id:2,sector:'Tecnologia',role:'colaborador',active:1},
  {id:3,name:'João Lima',email:'joao@empresa.com',sector_id:2,sector:'Tecnologia',role:'admin',active:0},
  {id:4,name:'Pessoa sem setor',email:'pessoa@empresa.com',sector_id:null,sector:null,role:'colaborador',active:0},
];

test('pesquisa de pessoas encontra nome, e-mail e setor sem acentos ou ordem fixa',()=>{
  const ids=query=>filterPeople(people,{query}).map(p=>p.id);
  assert.deepEqual(ids('  JOSE  '),[1]);assert.deepEqual(ids('jose\u0301'),[1]);
  assert.deepEqual(ids('administracao'),[1]);assert.deepEqual(ids('maria@empresa.com'),[2]);
  assert.deepEqual(ids('  tecnologia\tMARIA '),[2]);assert.deepEqual(ids('silva tecnologia'),[]);
  assert.deepEqual(ids('<script>'),[]);assert.deepEqual(ids(''),[1,2,3,4]);
});

test('filtros combinados preservam os IDs, a ordem e os dados das pessoas',()=>{
  const original=structuredClone(people);
  assert.deepEqual(filterPeople(people,{sectorId:'2',role:'admin',access:'inactive'}).map(p=>p.id),[3]);
  assert.deepEqual(filterPeople(people,{query:'tecnologia',role:'colaborador',access:'active'}).map(p=>p.id),[2]);
  assert.deepEqual(filterPeople(people,{sectorId:1,access:'inactive'}),[]);
  assert.deepEqual(filterPeople(people,{access:'inactive'}).map(p=>p.id),[3,4]);
  assert.deepEqual(filterPeople(people,{query:'\n  '}),people);assert.deepEqual(filterPeople([]),[]);
  assert.deepEqual(people,original);assert.notEqual(filterPeople(people),people);
  assert.throws(()=>filterPeople(people,{role:'invalido'}),/perfil inválido/);
  assert.throws(()=>filterPeople(people,{access:'invalido'}),/acesso inválido/);
});

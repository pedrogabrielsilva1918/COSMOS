import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRequestSearch } from '../public/request-search.js';
const request={id:12,title:'Aquisição de equipamentos',description:'Material para a recepção',author:'João da Silva',sector:'Administração'};
test('busca de pedidos combina campos sem acentos, maiúsculas ou ordem de palavras',()=>{
  for(const query of ['','  ','COS-00012','JOAO material','recepcao administracao','equipamentos silva']) assert.equal(matchesRequestSearch(request,query),true,query);
  for(const query of ['COS-00013','joao inexistente','outro setor'])assert.equal(matchesRequestSearch(request,query),false,query);
});
test('busca de pedidos trata texto como literal e campos ausentes como vazios',()=>{
  assert.equal(matchesRequestSearch({id:2},'COS-00002'),true);
  for(const query of ['.*','%','<script>']) assert.equal(matchesRequestSearch(request,query),false);
});

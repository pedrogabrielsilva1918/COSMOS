import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { once } from 'node:events';
import { spreadsheetExport } from '../spreadsheet-export.js';
import { createApp } from '../server.js';

function unpack(bytes) {
  const files={};let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    assert.equal(bytes.readUInt16LE(offset+8),8);
    const length=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extra;
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString();
    files[name]=inflateRawSync(bytes.subarray(start,start+length)).toString();offset=start+length;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  return files;
}
test('XLSX contém estilos, filtros, cabeçalho fixo, números e textos sem fórmulas',()=>{
  const files=unpack(spreadsheetExport(['Nome','Total'],[['=SUM(1,2) & <teste>',42],['José\n"Silva"\u0000',0]]));
  const sheet=files['xl/worksheets/sheet1.xml'];
  assert.match(sheet,/state="frozen"/);assert.match(sheet,/<autoFilter ref="A1:B3"/);assert.match(sheet,/<cols>/);
  assert.match(sheet,/t="inlineStr"><is><t xml:space="preserve">=SUM\(1,2\) &amp; &lt;teste&gt;/);
  assert.match(sheet,/<c r="B2" s="0" t="n"><v>42<\/v>/);assert.match(sheet,/<c r="B3" s="2" t="n"><v>0<\/v>/);
  assert.doesNotMatch(sheet,/<f[ >]|\u0000/);assert.match(sheet,/José\n&quot;Silva&quot;/);assert.match(files['xl/styles.xml'],/FF2D7062/);
  assert.match(unpack(spreadsheetExport(['Nome'],[]))['xl/worksheets/sheet1.xml'],/autoFilter ref="A1:A1"/);
});
test('exportações XLSX compartilham filtros, ordenação e isolamento das exportações CSV',async t=>{
  const app=createApp({databasePath:':memory:'});app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>app.close(resolve)));
  const base=`http://127.0.0.1:${app.address().port}`;
  const post=async(path,body,cookie='')=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const register=email=>post('/api/register',{name:'=Ana & João',organization:'Exportação',type:'privada',email,password:'Exportacao-segura-2026!'});
  const a=await register('xlsx-a@example.com'),b=await register('xlsx-b@example.com');
  const get=(path,cookie=a.cookie)=>fetch(base+path,{headers:{cookie}});
  const workspace=await (await get('/api/workspace')).json(),sector=workspace.sectors[0].id;
  const c=await post('/api/users',{name:'Colaborador',email:'xlsx-c@example.com',password:'Exportacao-segura-2026!',role:'colaborador',sector_id:sector},a.cookie);assert.equal(c.status,201);
  const login=await post('/api/login',{email:'xlsx-c@example.com',password:'Exportacao-segura-2026!'});
  for(const [title,cookie] of [['Pedido privado',a.cookie],['Pedido colaborador',login.cookie]])assert.equal((await post('/api/requests',{title,description:'=HYPERLINK("teste")',sector_id:sector,priority:'normal'},cookie)).status,201);
  const read=async(path,cookie=a.cookie)=>{const r=await get(path,cookie);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/spreadsheetml/);assert.match(r.headers.get('content-disposition'),/\.xlsx/);assert.equal(r.headers.get('cache-control'),'no-store');return unpack(Buffer.from(await r.arrayBuffer()))['xl/worksheets/sheet1.xml'];};
  const all=await read('/api/requests/export.xlsx?order=oldest');assert.ok(all.indexOf('Pedido privado')<all.indexOf('Pedido colaborador'));assert.match(all,/HYPERLINK/);assert.doesNotMatch(all,/<f[ >]/);
  assert.doesNotMatch(await read('/api/requests/export.xlsx',login.cookie),/Pedido privado/);
  assert.doesNotMatch(await read('/api/requests/export.xlsx',b.cookie),/Pedido privado|Pedido colaborador/);
  const filtered=await read('/api/requests/export.xlsx?q=colaborador');assert.match(filtered,/Pedido colaborador/);assert.doesNotMatch(filtered,/Pedido privado/);
  assert.match(await read('/api/requests/summary.xlsx?q=colaborador'),/<v>1<\/v>/);
  assert.match(await read('/api/users/export.xlsx?q=xlsx-c'),/xlsx-c@example.com/);
  assert.doesNotMatch(await read('/api/users/export.xlsx?q=ausente'),/xlsx-c@example.com/);
  assert.match(await read('/api/history/export.xlsx'),/Responsável/);
  for(const path of ['/api/users/export.xlsx','/api/history/export.xlsx'])assert.equal((await get(path,login.cookie)).status,403);
  for(const path of ['/api/requests/export.xlsx','/api/requests/summary.xlsx','/api/users/export.xlsx','/api/history/export.xlsx'])assert.equal((await get(path,'')).status,401);
  for(const path of ['/api/requests/export.xlsx?status=invalido','/api/requests/summary.xlsx?order=invalido','/api/users/export.xlsx?role=invalido','/api/history/export.xlsx?before=1'])assert.equal((await get(path)).status,400);
  const csv=await get('/api/requests/export.csv');assert.equal(csv.headers.get('content-type'),'text/csv; charset=utf-8');assert.match(await csv.text(),/Pedido privado/);
});

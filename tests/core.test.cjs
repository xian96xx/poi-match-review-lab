const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
require('../demo-data.js');

test('demo classifies IDs, ambiguity, missing, cross-city and ID conflicts',()=>{
 const r=C.evaluate(globalThis.DEMO.references,globalThis.DEMO.candidates);
 assert.deepEqual(r.map(x=>x.status),['id_match','id_match','suggested','ambiguous','unmatched','incomplete','unmatched','ambiguous','conflict']);
 assert.equal(r[0].suggested.platform,'甲图');assert.equal(r[1].suggested.platform,'乙图');
 assert.equal(r[3].options.length,2);assert.equal(r[7].options.length,2);
 assert.ok(r.every(x=>x.decision==='pending'));
});
test('CSV parses BOM, quoted commas, escaped quotes and embedded newline',()=>{
 const rows=C.parseCSV('\ufeffref_id,platform,platform_id,name,city,address\r\n1,A,,"A, B",C,"road ""blue""\nsecond"\r\n',C.REQUIRED_REF);
 assert.equal(rows[0].name,'A, B');assert.equal(rows[0].address,'road "blue"\nsecond');
});
test('reject malformed rows, duplicate fields, IDs and oversized inputs',()=>{
 assert.throws(()=>C.parseCSV('ref_id,ref_id\nx,y',['ref_id']),/重复/);
 assert.throws(()=>C.parseCSV('a,b\n"open,x',['a','b']),/引号/);
 assert.throws(()=>C.parseCSV('a,b\n1',['a','b']),/列数/);
 assert.throws(()=>C.parseCSV('x\n'+'a'.repeat(C.MAX_BYTES),['x']),/1 MiB/);
 assert.throws(()=>C.evaluate([globalThis.DEMO.references[0],globalThis.DEMO.references[0]],[]),/重复/);
});
test('city missing and mismatched candidates never become auto matches',()=>{
 const x={ref_id:'T1',platform:'A',platform_id:'',name:'店',city:'',address:''};
 assert.equal(C.evaluate([x],[])[0].status,'incomplete');
 const c={platform:'A',platform_id:'1',name:'店',city:'乙',address:''};
 assert.equal(C.evaluate([{...x,city:'甲'}],[c])[0].status,'unmatched');
});
test('export neutralizes spreadsheet formulas and escapes CSV',()=>{
 const rows=C.evaluate([{ref_id:'=1+1',platform:'甲',platform_id:'',name:'"点"',city:'甲',address:''}],[]);
 const out=C.exportCSV(rows);assert.match(out,/"\x27=1\+1"/);assert.match(out,/""点""/);
});

test('export does not assign top score to another candidate or a draft',()=>{
 const r=C.evaluate(globalThis.DEMO.references,globalThis.DEMO.candidates);
 r[3].selected=r[3].options[1]; r[3].draft_reason='未提交';
 const [row]=C.parseCSV(C.exportCSV([r[3]]),['score','review_reason']);
 assert.equal(row.score,''); assert.equal(row.review_reason,'');
});

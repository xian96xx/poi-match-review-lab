(function (root) {
  'use strict';
  const REQUIRED_REF = ['ref_id','platform','platform_id','name','city','address'];
  const REQUIRED_CAND = ['platform','platform_id','name','city','address'];
  const MAX_ROWS = 2000;
  const MAX_BYTES = 1024 * 1024;
  function normalize(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  }
  function bigrams(s) {
    const chars = Array.from(normalize(s));
    if (chars.length < 2) return new Set(chars);
    return new Set(chars.slice(0,-1).map((c,i) => c + chars[i+1]));
  }
  function similarity(a,b) {
    const x=bigrams(a), y=bigrams(b);
    if (!x.size || !y.size) return 0;
    let shared=0; for (const value of x) if (y.has(value)) shared++;
    return 2*shared/(x.size+y.size);
  }
  function parseCSV(text, required) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('CSV 为空或超过 1 MiB。');
    text=text.replace(/^\uFEFF/, '');
    let rows=[], row=[], field='', inQuote=false, afterQuote=false, fieldStart=true;
    for (let i=0; i<text.length; i++) {
      const ch=text[i];
      if (inQuote) {
        if (ch==='"' && text[i+1]==='"') { field+='"'; i++; }
        else if (ch==='"') { inQuote=false; afterQuote=true; }
        else field+=ch;
      } else if (ch===',' || ch==='\r' || ch==='\n') {
        row.push(field); field=''; afterQuote=false; fieldStart=true;
        if (ch!==',') { rows.push(row); row=[]; if (ch==='\r' && text[i+1]==='\n') i++; }
      } else if (ch==='"' && fieldStart) { inQuote=true;fieldStart=false; }
      else { if (afterQuote || ch==='"') throw new Error('CSV 引号格式有误。'); field+=ch;fieldStart=false; }
    }
    if (inQuote) throw new Error('CSV 引号未闭合。');
    if (field || row.length || afterQuote) {row.push(field); rows.push(row);}
    if (!rows.length) throw new Error('CSV 缺少表头。');
    const headers=rows.shift().map(x=>x.trim());
    if (new Set(headers).size!==headers.length) throw new Error('CSV 表头重复。');
    const missing=required.filter(h=>!headers.includes(h));
    if (missing.length) throw new Error('缺少字段：'+missing.join(', '));
    rows=rows.filter(r=>r.some(x=>x.trim()!==''));
    if (rows.length>MAX_ROWS) throw new Error('每个文件最多 2000 行。');
    return rows.map((r, i)=>{
      if (r.length!==headers.length) throw new Error(`第 ${i+2} 行列数与表头不一致。`);
      return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));
    });
  }
  function validate(rows, columns, label) {
    if (!Array.isArray(rows) || rows.length>MAX_ROWS) throw new Error(label+'不是有效数组或行数过多。');
    for (const [i,row] of rows.entries()) {
      if (!row || columns.some(k=>typeof row[k]!=='string')) throw new Error(`${label}第 ${i+1} 条字段不完整。`);
    }
  }
  function evaluate(refs, candidates) {
    validate(refs,REQUIRED_REF,'参考表');validate(candidates,REQUIRED_CAND,'候选表');
    const seen=new Set();
    for (const ref of refs) {
      const id=ref.ref_id.trim();if (!id || seen.has(id)) throw new Error('参考表 ref_id 不能为空或重复。');seen.add(id);
    }
    return refs.map(ref=>{
      const base={ref,decision:'pending',review_reason:'',suggested:null,selected:null,options:[],score:null};
      if (!normalize(ref.platform) || !normalize(ref.name) || !normalize(ref.city))
        return {...base,status:'incomplete',reason:'平台、名称和城市是必填项，信息不足。'};
      const pool=candidates.filter(c=>normalize(c.platform)===normalize(ref.platform));
      const id=ref.platform_id.trim();
      if (id) {
        const exact=pool.filter(c=>c.platform_id.trim()===id);
        if (exact.length>1) return {...base,status:'ambiguous',options:exact,reason:`同平台 ID 有 ${exact.length} 条候选，不能自动确定。`};
        if (exact.length===1) {
          if (!normalize(exact[0].city) || normalize(ref.city)!==normalize(exact[0].city))
            return {...base,status:'conflict',suggested:exact[0],options:exact,reason:'同平台 ID 命中，但城市缺失或不一致。'};
          return {...base,status:'id_match',suggested:exact[0],options:exact,reason:'同平台 ID 和城市一致，仍需复核。'};
        }
      }
      // No cross-city fallback: a city mismatch is never used as a fuzzy candidate.
      const sameCity=pool.filter(c=>normalize(c.city) && normalize(c.city)===normalize(ref.city) && normalize(c.name));
      const scored=sameCity.map(c=>{
        const name=similarity(ref.name,c.name); const address=similarity(ref.address,c.address);
        // When either address is missing, name alone is shown as a lead, with no fake missing-data score.
        const hasAddress=!!normalize(ref.address) && !!normalize(c.address);
        const score=hasAddress?0.6*name+0.4*address:name;
        return {candidate:c,score,name,hasAddress};
      }).filter(x=>x.name>=0.6 && x.score>=0.75).sort((a,b)=>b.score-a.score);
      if (!scored.length) return {...base,status:'unmatched',reason:id?'ID 未命中，且没有同城候选达到门槛。':'没有同城候选达到门槛。'};
      const best=scored[0];
      if (scored.length>1 && best.score-scored[1].score<0.10)
        return {...base,status:'ambiguous',options:scored.map(x=>x.candidate),score:best.score,reason:`同城有 ${scored.length} 个候选，前两名差距不足 0.10。`};
      return {...base,status:'suggested',suggested:best.candidate,options:scored.map(x=>x.candidate),score:best.score,reason:best.hasAddress?'同城候选：名称 60%、地址 40% 的相似度，仅供复核。':'地址缺失：仅按名称生成线索，需重点复核。'};
    });
  }
  function csvCell(value) {
    let s=String(value ?? '');
    // Spreadsheet formula injection: prefix an apostrophe, including whitespace-led formulas.
    if (/^[\s]*[=+\-@]/u.test(s)) s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  function exportCSV(results) {
    const header=['ref_id','platform','reference_name','reference_city','status','candidate_id','candidate_name','candidate_city','candidate_address','score','rule_reason','review_decision','review_reason'];
    const lines=results.map(r=>[r.ref.ref_id,r.ref.platform,r.ref.name,r.ref.city,r.status,(r.selected ?? r.suggested)?.platform_id ?? '',(r.selected ?? r.suggested)?.name ?? '',(r.selected ?? r.suggested)?.city ?? '',(r.selected ?? r.suggested)?.address ?? '',r.score===null || !r.suggested || (r.selected && r.selected!==r.suggested)?'':r.score.toFixed(3),r.reason,r.decision,r.review_reason]);
    return '\uFEFF'+[header,...lines].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  const api={REQUIRED_REF,REQUIRED_CAND,MAX_ROWS,MAX_BYTES,parseCSV,evaluate,similarity,exportCSV};
  if (typeof module !== 'undefined' && module.exports) module.exports=api; else root.PoiCore=api;
})(globalThis);

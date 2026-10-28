(() => {
  'use strict';
  const $=id=>document.getElementById(id), C=globalThis.PoiCore;
  const labels={id_match:'ID 命中',suggested:'相似候选',ambiguous:'多候选待判断',conflict:'城市冲突',unmatched:'暂无线索',incomplete:'信息不足'};
  const decisions={pending:'待复核',confirmed:'已确认',rejected:'已退回',no_candidate:'确认暂无线索'};
  let results=[];
  function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;}
  function message(text,isError=false){$('message').textContent=text;$('message').style.color=isError?'#a93b33':'#176d5a';}
  function run(refs,cands,source){
    if (!refs.length) throw new Error('参考表没有数据行。');
    results=C.evaluate(refs,cands);$('download').disabled=false; $('filter').value='all';render();
    message(`${source}：${refs.length} 条参考记录，${cands.length} 条候选记录。复核状态已重置。`);
  }
  function render(){
    const stats=$('stats');stats.replaceChildren();
    const pending=results.filter(r=>r.decision==='pending').length;
    const totals=[['参考记录',results.length],['同平台 ID 命中',results.filter(r=>r.status==='id_match').length],['相似候选',results.filter(r=>r.status==='suggested').length],['待人工复核',pending]];
    for(const [label,value] of totals){const box=node('div',undefined,'metric');box.append(node('strong',value),node('span',label));stats.append(box);}
    $('distribution').textContent=Object.keys(labels).map(k=>labels[k]+' '+results.filter(r=>r.status===k).length).join(' · ');
    const container=$('results');container.replaceChildren();const filter=$('filter').value;
    const visible=results.filter(r=>filter==='all'||r.decision===filter);
    if(!visible.length){container.append(node('div','没有符合筛选条件的记录。','empty'));return;}
    for(const r of visible){
      const card=node('article',undefined,'record');card.dataset.refId=r.ref.ref_id;
      const head=node('div',undefined,'record-head');head.append(node('strong',r.ref.ref_id+' · '+(r.ref.name||'未提供名称')),node('span',labels[r.status],'badge '+r.status),node('span',decisions[r.decision],'badge'));
      card.append(head,node('p',`${r.ref.platform||'未提供平台'} · ${r.ref.city||'未提供城市'} · ${r.ref.address||'未提供地址'}`,'bodyline'));
      let description=r.reason;if(r.score!==null)description+=` 相似度 ${r.score.toFixed(3)}（不是置信概率）。`;
      card.append(node('p',description,'reason'));
      const form=node('div',undefined,'review');
      const candidate=node('select');candidate.setAttribute('aria-label',r.ref.ref_id+' 选择候选');
      candidate.append(new Option(r.options.length?'请选择候选':'无可选候选',''));
      r.options.forEach((c,i)=>candidate.append(new Option(`${c.name || '无名称'} · ${c.platform_id || '无 ID'} · ${c.city || '无城市'} · ${c.address || '无地址'}`,String(i))));
      const current=r.selected ?? r.suggested;
      if(current){const ix=r.options.indexOf(current);if(ix>=0)candidate.value=String(ix);}
      if(r.draft_candidate!==undefined)candidate.value=r.draft_candidate;
      candidate.addEventListener('change',()=>{r.draft_candidate=candidate.value;});
      const reason=node('input');reason.type='text';reason.maxLength=300;reason.placeholder='填写复核原因';reason.setAttribute('aria-label',r.ref.ref_id+' 复核原因');reason.value=r.draft_reason ?? r.review_reason;reason.addEventListener('input',()=>{r.draft_reason=reason.value;});
      const yes=node('button',r.status==='unmatched'?'确认暂无线索':'确认');yes.type='button';
      const no=node('button','退回');no.type='button';
      yes.addEventListener('click',()=>{
        if(!reason.value.trim()){message('请先填写 '+r.ref.ref_id+' 的复核原因。',true);reason.focus();return;}
        if(r.status==='unmatched' && !r.options.length){r.selected=null;r.decision='no_candidate';}
        else {
          if(candidate.value===''){message('请为 '+r.ref.ref_id+' 选择候选后再确认。',true);candidate.focus();return;}
          r.selected=r.options[Number(candidate.value)];r.decision='confirmed';
        }
        r.review_reason=reason.value.trim();message(r.ref.ref_id+' 已保存复核。');render();
      });
      no.addEventListener('click',()=>{
        if(!reason.value.trim()){message('请先填写 '+r.ref.ref_id+' 的复核原因。',true);reason.focus();return;}
        r.selected=candidate.value===''?null:r.options[Number(candidate.value)];r.decision='rejected';r.review_reason=reason.value.trim();message(r.ref.ref_id+' 已退回。');render();
      });
      form.append(candidate,reason,yes,no);card.append(form);container.append(card);
    }
  }
  $('demo').addEventListener('click',()=>{try{run(DEMO.references,DEMO.candidates,'原创合成演示');}catch(e){message(e.message,true);}});
  $('importBtn').addEventListener('click',async()=>{
    try{
      const ref=$('refFile').files[0],cand=$('candFile').files[0];
      if(!ref||!cand)throw new Error('请选择参考表和候选表两个文件。');
      if(ref.size>C.MAX_BYTES||cand.size>C.MAX_BYTES)throw new Error('单个文件不得超过 1 MiB。');
      const refs=C.parseCSV(await ref.text(),C.REQUIRED_REF), candidates=C.parseCSV(await cand.text(),C.REQUIRED_CAND);
      run(refs,candidates,'本地导入');
    }catch(e){message(e.message,true);}
  });
  $('filter').addEventListener('change',()=>{if(results.length)render();});
  $('download').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([C.exportCSV(results)],{type:'text/csv;charset=utf-8'}));
    const a=node('a');a.href=url;a.download='poi-review-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
})();

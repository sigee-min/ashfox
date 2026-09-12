'use strict';
const labels = { apple:['사과','음식','붉은 껍질과 작은 잎. 둥근 면 위에 빛을 채웠습니다.'],green_apple:['청사과','음식','사과의 형태를 공유하고 초록색 램프를 적용했습니다.'],golden_apple:['황금 사과','음식','같은 실루엣에 따뜻한 금색 명암을 적용했습니다.'],iron_sword:['철 검','도구','칼날 양쪽의 경사면이 금속의 빛을 나눕니다.'],copper_sword:['구리 검','도구','공유 칼날에 구리색 램프를 적용했습니다.'],crystal_sword:['수정 검','도구','차가운 청록색과 밝은 칼날의 대비.'],ruby_potion:['붉은 물약','물약','병과 내용물을 별도의 부위로 표현했습니다.'],blue_potion:['푸른 물약','물약','유리병은 그대로, 내용물의 색만 바꿨습니다.'],amber_potion:['황금 물약','물약','금빛 내용물 위에 유리의 반사광을 더했습니다.'],amethyst:['자수정','재료','보라색 램프에 작은 군집형 질감을 더했습니다.'] };
const order=['apple','green_apple','golden_apple','iron_sword','copper_sword','crystal_sword','ruby_potion','blue_potion','amber_potion','amethyst'];
const $=selector=>document.querySelector(selector);
let source,receipt,selected,stage='final',codeMode='item',codeText='';
const evidence=new Map();
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const title=id=>labels[id]?.[0]||id;
const family=id=>id.includes('apple')?'apple':id.includes('sword')?'sword':id.includes('potion')?'potion':id;
function highlight(line){return escape(line).replace(/("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(-?\d+(?:\.\d+)?)\b|\b(true|false|null)\b/g,(all,key,string,number)=>`<span class="${key?'key':string?'string':number?'number':'literal'}">${all}</span>`);}
function showCode(target){
 const item=source.items.find(i=>i.id===selected);
 if(source.native){
  const own=source.paths[selected];
  const files=codeMode==='item'?source.files.filter(f=>f.path===own):source.files.filter(f=>codeMode==='full'||source.references[selected].includes(f.path));
  codeText=files.map(f=>`// ${f.path}\n${f.source}`).join('\n');
  $('#fileName').textContent=codeMode==='item'?own:codeMode==='full'?'workspace sources':'shared .ashfox sources';
  let marked=false;
  $('#code').innerHTML=codeText.split('\n').map((line,index)=>{
   const hit=target&&!marked&&line.includes(target);if(hit)marked=true;
   return `<span class="code-line${hit?' target':''}"><span class="ln">${index+1}</span>${highlight(line)}</span>`;
  }).join('');
  document.querySelectorAll('[data-code]').forEach(b=>{b.classList.toggle('active',b.dataset.code===codeMode);b.setAttribute('aria-pressed',String(b.dataset.code===codeMode));});
  if(target)$('#code .target')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  return;
 }
 let value=item;
 if(codeMode==='shape')value={masks:source.masks.filter(m=>item.layers.some(l=>l.mask===m.id)),stamps:source.stamps.filter(s=>item.layers.some(l=>l.stamp===s.id))};
 if(codeMode==='material')value={materials:source.materials.filter(m=>item.layers.some(l=>l.material===m.id)),palette:item.palette};
 if(codeMode==='full')value=source;
 codeText=JSON.stringify(value,null,2).replace(/\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]/g,(_,values)=>'['+values.replace(/\s+/g,'').split(',').join(', ')+']');
 $('#fileName').textContent=codeMode==='full'?'study.items.json':`${selected} / ${codeMode==='shape'?'형태':codeMode==='material'?'재질':'아이템'}`;
 let marked=false;
 $('#code').innerHTML=codeText.split('\n').map((line,index)=>{
  const hit=target&&!marked&&line.includes(`"id": "${target}"`);if(hit)marked=true;
  return `<span class="code-line${hit?' target':''}"><span class="ln">${index+1}</span>${highlight(line)}</span>`;
 }).join('');
 document.querySelectorAll('[data-code]').forEach(b=>{b.classList.toggle('active',b.dataset.code===codeMode);b.setAttribute('aria-pressed',String(b.dataset.code===codeMode));});
 if(target)$('#code .target')?.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function preview(){
 const src=stage==='final'?`${selected}@16x.png`:`${selected}.${stage}.png`;
 $('#preview').src=src;$('#native').src=stage==='final'?`${selected}.png`:src;
 $('#preview').alt=`${title(selected)} · ${stage==='final'?'완성':stage==='shade'?'명암':stage==='grain'?'질감':'형태'}`;
 document.querySelectorAll('[data-stage]').forEach(b=>{b.classList.toggle('active',b.dataset.stage===stage);b.setAttribute('aria-pressed',String(b.dataset.stage===stage));});
 $('#scale').textContent=`${Math.round($('#preview').getBoundingClientRect().width/16)}배 확대`;
}
function select(id){
 selected=id;const item=source.items.find(i=>i.id===id),r=receipt.items.find(i=>i.id===id);
 $('#name').textContent=title(id);$('#category').textContent=(labels[id]?.[1]||'아이템')+' / '+id;
 $('#description').textContent=labels[id]?.[2]||'선언형 코드로 컴파일한 16픽셀 아이템입니다.';
 $('#colors').textContent=`${r.colors}색`;$('#lightInfo').textContent=item.layers.some(l=>l.op==='part')?'좌상단 광원':'명시적 픽셀';
 $('#download').href=`${id}.png`;$('#download').download=`${id}.png`;
 if(source.native){$('#sourceDownload').href=`${id}.source.ashfox`;$('#sourceDownload').download=source.paths[id].split('/').pop();}
 document.querySelectorAll('.item-button').forEach(b=>{b.classList.toggle('active',b.dataset.id===id);b.setAttribute('aria-pressed',String(b.dataset.id===id));});
 $('#variants').replaceChildren();
 for(const other of receipt.items.filter(i=>family(i.id)===family(id))){
  const b=document.createElement('button');b.className='variant'+(other.id===id?' active':'');b.setAttribute('aria-label',title(other.id)+' 선택');
  const img=document.createElement('img');img.src=`${other.id}.png`;img.alt='';const text=document.createElement('span');text.textContent=title(other.id);b.append(img,text);b.onclick=()=>select(other.id);$('#variants').append(b);
 }
 $('.variants').hidden=$('#variants').children.length<2;
 $('#pixelInfo').textContent='소스에서 형태와 색을 정하면, 컴파일러가 명암을 채웁니다.';
 preview();showCode();
}
for(const b of document.querySelectorAll('[data-stage]'))b.onclick=()=>{stage=b.dataset.stage;preview();};
for(const b of document.querySelectorAll('[data-bg]'))b.onclick=()=>{
 $('#canvas').className='canvas '+b.dataset.bg;document.querySelectorAll('[data-bg]').forEach(other=>{other.classList.toggle('active',other===b);other.setAttribute('aria-pressed',String(other===b));});
};
for(const b of document.querySelectorAll('[data-code]'))b.onclick=()=>{codeMode=b.dataset.code;showCode();};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(codeText);$('#copy').textContent='복사됨';setTimeout(()=>{$('#copy').textContent='복사';},1500);}catch(error){$('#sourceHint').textContent='복사할 코드를 직접 선택해 주세요.';}};
$('#preview').onclick=async event=>{
 const id=selected;if(stage!=='final'){stage='final';preview();}
 if(!evidence.has(id))evidence.set(id,await fetch(`${id}.evidence.json`).then(r=>r.json()));
 if(selected!==id)return;const rect=$('#preview').getBoundingClientRect();const x=Math.max(0,Math.min(15,Math.floor((event.clientX-rect.left)*16/rect.width))),y=Math.max(0,Math.min(15,Math.floor((event.clientY-rect.top)*16/rect.height)));
 const e=evidence.get(id)[y*16+x];if(!e){$('#pixelInfo').textContent=`(${x}, ${y}) · 투명한 픽셀`;return;}
 codeMode='item';showCode(e.patch||e.layer);$('#pixelInfo').textContent=`(${x}, ${y}) → ${e.layer}${e.patch?' / '+e.patch:''}${e.baseTone===null?' · 직접 지정한 색':` · 명암 ${e.baseTone+1}/5${e.grainDelta?' · 질감 '+e.grainDelta:''}`}`;
};
window.addEventListener('resize',()=>{if(selected)preview();});
Promise.all([fetch('source.json').then(r=>r.json()),fetch('receipt.json').then(r=>r.json())]).then(([s,r])=>{
 source=s;receipt=r;$('#count').textContent=`· ${r.items.length}개`;$('#total').textContent=r.items.length;
 const items=[...r.items].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?100:ai)-(bi<0?100:bi)||a.id.localeCompare(b.id);});
 for(const item of items){const b=document.createElement('button');b.className='item-button';b.dataset.id=item.id;b.setAttribute('aria-label',title(item.id));const img=document.createElement('img');img.src=`${item.id}.png`;img.alt='';const label=document.createElement('div');label.textContent=title(item.id);const sub=document.createElement('div');sub.className='sub';sub.textContent=labels[item.id]?.[1]||'아이템';label.append(sub);b.append(img,label);b.onclick=()=>select(item.id);$('#items').append(b);}
 select(items[0].id);
}).catch(error=>{$('#name').textContent='결과를 불러오지 못했습니다';$('#description').textContent=error.message;$('.build-status').textContent='불러오기 실패';});

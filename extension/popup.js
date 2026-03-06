// XPath Explorer – Popup / Side Panel Script

const input         = document.getElementById('xpath-input');
const hlBtn         = document.getElementById('hl-btn');
const resultsWrap   = document.getElementById('results-wrap');
const suggestionsEl = document.getElementById('suggestions');
const livePill      = document.getElementById('live-pill');
const liveText      = document.getElementById('live-text');

function H(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Page context ─────────────────────────────────────────────────
let pageCtx = null;
async function loadPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({ target:{ tabId: tab.id }, files:['content.js'] }).catch(()=>{});
    pageCtx = await chrome.tabs.sendMessage(tab.id, { action:'getPageContext' });
  } catch(e) { pageCtx = null; }
}
loadPageContext();

// ── Smart Preset System ──────────────────────────────────────────
const ELEM_DEFS = {
  all:      { label:'* todos',  base:'//*',              mods:['elem','text','id','class'],         filters:['id-filter','class-filter'] },
  nav:      { label:'nav',      base:'//nav',             mods:['elem','links-in','text','class','id'] },
  links:    { label:'links',    base:'//a[@href]',         mods:['elem','href','text','class'] },
  headings: { label:'headings', base:'//h1|//h2|//h3',     mods:['elem','text'] },
  img:      { label:'img',      base:'//img',              mods:['elem','src','alt','class'] },
  form:     { label:'form',     base:'//form',             mods:['elem','action','method','class','id'] },
  input:    { label:'input',    base:'//input',            mods:['elem','name','type','value','placeholder'] },
  button:   { label:'button',   base:'//button',           mods:['elem','text','type','class'] },
  id:       { label:'#id',      base:'//*[@id]',           mods:['elem','text','class'],             filters:['id-filter'] },
  class:    { label:'.clase',   base:'//*[@class]',        mods:['elem','text','id'],                filters:['class-filter'] },
  list:     { label:'lista',    base:'//ul/li',            mods:['elem','text','links-in'] },
  table:    { label:'tabla',    base:'//table//tr',        mods:['elem','text'] },
  meta:     { label:'meta',     base:'//meta[@name]',      mods:['elem','content','name'] },
  p:        { label:'párrafo',  base:'//p',                mods:['elem','text'],                     filters:['class-filter'] },
};

const MOD_DEFS = {
  'elem':         { label:'elemento completo', needsInput:false, build:(b,v)=>b },
  'text':         { label:'texto interno',     needsInput:false, build:(b,v)=>b.includes('|')?'('+b+')/text()':b+'/text()' },
  'href':         { label:'href →',            needsInput:false, build:(b,v)=>b+'/@href' },
  'src':          { label:'src →',             needsInput:false, build:(b,v)=>b+'/@src' },
  'alt':          { label:'alt →',             needsInput:false, build:(b,v)=>b+'/@alt' },
  'name':         { label:'name →',            needsInput:false, build:(b,v)=>b+'/@name' },
  'type':         { label:'type →',            needsInput:false, build:(b,v)=>b+'/@type' },
  'value':        { label:'value →',           needsInput:false, build:(b,v)=>b+'/@value' },
  'placeholder':  { label:'placeholder →',     needsInput:false, build:(b,v)=>b+'/@placeholder' },
  'id':           { label:'id →',              needsInput:false, build:(b,v)=>b+'/@id' },
  'class':        { label:'class →',           needsInput:false, build:(b,v)=>b+'/@class' },
  'action':       { label:'action →',          needsInput:false, build:(b,v)=>b+'/@action' },
  'method':       { label:'method →',          needsInput:false, build:(b,v)=>b+'/@method' },
  'content':      { label:'content →',         needsInput:false, build:(b,v)=>b+'/@content' },
  'links-in':     { label:'links dentro →',    needsInput:false, build:(b,v)=>b+'//a/@href' },
  'class-filter': { label:'filtrar por clase', needsInput:true,  placeholder:'ej: btn-primary',
                    build:(b,v)=>v ? b+'[contains(@class,"'+v.replace(/^\./,'')+'")]' : b+'[contains(@class,"…")]' },
  'id-filter':    { label:'filtrar por ID',    needsInput:true,  placeholder:'ej: main-content',
                    build:(b,v)=>v ? b+'[@id="'+v.replace(/^#/,'')+'"]' : b+'[@id="…"]' },
};

let selectedElem = null, selectedMod = null, selectedFilt = null, filtValue = '';

function renderPresets() {
  document.getElementById('elem-chips').querySelectorAll('.chip').forEach(chip =>
    chip.classList.toggle('selected', chip.dataset.elem === selectedElem)
  );
  const modRow   = document.getElementById('mod-row');
  const modChips = document.getElementById('mod-chips');
  const modName  = document.getElementById('mod-elem-name');
  const filtSec  = document.getElementById('filt-section');

  if (!selectedElem) { modRow.classList.remove('visible'); return; }
  const def = ELEM_DEFS[selectedElem];
  modName.textContent = def.label;
  modRow.classList.add('visible');

  modChips.innerHTML = def.mods.map(m =>
    '<div class="chip mod-chip'+(m===selectedMod?' selected':'')+'" data-mod="'+m+'">'+MOD_DEFS[m].label+'</div>'
  ).join('');
  modChips.querySelectorAll('.chip').forEach(chip =>
    chip.addEventListener('click', () => {
      selectedMod = chip.dataset.mod; selectedFilt = null; filtValue = '';
      renderPresets(); applyPreset();
    })
  );

  const filters = def.filters || [];
  if (filters.length) {
    filtSec.style.display = 'flex';
    filtSec.innerHTML = '';
    filters.forEach(fk => {
      const fd = MOD_DEFS[fk];
      const isActive = selectedFilt === fk;
      const btn = document.createElement('button');
      btn.className = 'filt-btn' + (isActive ? ' active' : '');
      btn.textContent = fd.label;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.className = 'filt-input' + (isActive ? ' visible' : '');
      inp.placeholder = fd.placeholder || '';
      inp.value = isActive ? filtValue : '';
      inp.addEventListener('input', () => { filtValue = inp.value; applyPreset(); });
      btn.addEventListener('click', () => {
        if (selectedFilt === fk) { selectedFilt = null; filtValue = ''; if (selectedMod === fk) selectedMod = 'elem'; }
        else { selectedFilt = fk; selectedMod = fk; filtValue = ''; setTimeout(() => inp.focus(), 50); }
        renderPresets(); applyPreset();
      });
      filtSec.appendChild(btn);
      filtSec.appendChild(inp);
    });
  } else {
    filtSec.style.display = 'none';
  }
}

function applyPreset() {
  if (!selectedElem || !selectedMod) return;
  const xpath = MOD_DEFS[selectedMod].build(ELEM_DEFS[selectedElem].base, filtValue);
  input.value = xpath;
  clearTimeout(autoTimer);
  autoEval(xpath);
}

document.getElementById('elem-chips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip || !chip.dataset.elem) return;
  const elem = chip.dataset.elem;
  if (selectedElem === elem) { selectedElem = null; selectedMod = null; selectedFilt = null; filtValue = ''; }
  else { selectedElem = elem; selectedMod = 'elem'; selectedFilt = null; filtValue = ''; }
  renderPresets();
  if (selectedElem) applyPreset();
});

// ── Suggestion data ──────────────────────────────────────────────
const STEPS = [
  {step:'@href',desc:'href'},{step:'@src',desc:'src'},{step:'@class',desc:'class'},
  {step:'@id',desc:'id'},{step:'@alt',desc:'alt'},{step:'@title',desc:'title'},
  {step:'@name',desc:'name'},{step:'@type',desc:'type'},{step:'@value',desc:'value'},
  {step:'@placeholder',desc:'placeholder'},{step:'@aria-label',desc:'aria-label'},
  {step:'@role',desc:'role'},{step:'@content',desc:'content'},{step:'@action',desc:'action'},
  {step:'*',desc:'Cualquier elemento'},{step:'text()',desc:'Texto'},{step:'node()',desc:'Cualquier nodo'},
  {step:'nav',desc:'Navegación'},{step:'header',desc:'Cabecera'},{step:'footer',desc:'Pie'},
  {step:'main',desc:'Contenido'},{step:'article',desc:'Artículo'},{step:'section',desc:'Sección'},
  {step:'h1',desc:'h1'},{step:'h2',desc:'h2'},{step:'h3',desc:'h3'},{step:'p',desc:'Párrafo'},
  {step:'span',desc:'Span'},{step:'strong',desc:'Negrita'},{step:'label',desc:'Label'},
  {step:'a',desc:'Enlace'},{step:'a[@href]',desc:'Enlace con href'},
  {step:'img',desc:'Imagen'},{step:'img[@src]',desc:'Imagen con src'},
  {step:'ul',desc:'Lista'},{step:'ol',desc:'Lista ordenada'},{step:'li',desc:'Item'},
  {step:'li[1]',desc:'Primer item'},{step:'li[last()]',desc:'Último item'},
  {step:'div',desc:'Div'},{step:'div[@id]',desc:'Div con ID'},{step:'div[@class]',desc:'Div con clase'},
  {step:'form',desc:'Formulario'},{step:'input',desc:'Input'},{step:'button',desc:'Botón'},
  {step:'select',desc:'Dropdown'},{step:'textarea',desc:'Textarea'},
  {step:'table',desc:'Tabla'},{step:'tr',desc:'Fila'},{step:'td',desc:'Celda'},
  {step:'title',desc:'Título doc'},{step:'meta',desc:'Meta'},{step:'meta[@name]',desc:'Meta con nombre'},
  {step:'parent::*',desc:'Padre'},{step:'following-sibling::*',desc:'Hermanos siguientes'},
  {step:'child::*',desc:'Hijos directos'},
];
const PREDS = [
  {pred:'@class',desc:'Tiene clase'},{pred:'@id',desc:'Tiene id'},
  {pred:'@href',desc:'Tiene href'},{pred:'@src',desc:'Tiene src'},
  {pred:'contains(@class,"")',desc:'Clase contiene...'},{pred:'contains(@id,"")',desc:'Id contiene...'},
  {pred:'contains(text(),"")',desc:'Texto contiene...'},{pred:'starts-with(@href,"https")',desc:'href https'},
  {pred:'1',desc:'Primer hijo'},{pred:'last()',desc:'Último hijo'},{pred:'position()<=3',desc:'Primeros 3'},
  {pred:'not(@class)',desc:'Sin clase'},{pred:'normalize-space()!=""',desc:'Tiene texto'},
];
const FULL = [
  {expr:'//nav',desc:'Nav'},{expr:'//nav//a',desc:'Links en nav'},{expr:'//header',desc:'Cabecera'},
  {expr:'//footer',desc:'Pie'},{expr:'//main',desc:'Contenido'},{expr:'//h1',desc:'Título'},
  {expr:'//h1|//h2|//h3',desc:'Headings'},{expr:'//a[@href]',desc:'Todos los links'},
  {expr:'//a/@href',desc:'Solo URLs'},{expr:'//img/@src',desc:'URLs imágenes'},
  {expr:'//img/@alt',desc:'Textos alt'},{expr:'//form',desc:'Formularios'},
  {expr:'//input',desc:'Inputs'},{expr:'//button',desc:'Botones'},
  {expr:'//*[@id]',desc:'Con ID'},{expr:'//*[@class]',desc:'Con clase'},
  {expr:'//meta[@name]/@content',desc:'Contenido metas'},{expr:'//title',desc:'Título doc'},
  {expr:'count(//a)',desc:'Nº enlaces'},{expr:'//ul/li',desc:'Items lista'},
];

function getSuggestions(value) {
  if (!value) return [];
  const pm = value.match(/^(.*\[)([^\]]*)$/);
  if (pm) {
    const pre = pm[1], tok = pm[2].toLowerCase(), res = [];
    if (pageCtx) {
      pageCtx.ids.forEach(id => { if (res.length>=3||(!tok&&res.length>=1)) return; if (!tok||id.toLowerCase().includes(tok)) res.push({expr:pre+'@id="'+id+'"]',pre,suf:'@id="'+H(id)+'"]',desc:'#'+id,page:true}); });
      pageCtx.classes.forEach(cls => { if (res.length>=7) return; if (!tok||cls.toLowerCase().includes(tok)) res.push({expr:pre+'contains(@class,"'+cls+'")]',pre,suf:'contains(@class,"'+H(cls)+'")]',desc:'.'+cls,page:true}); });
    }
    PREDS.forEach(p => { if (res.length>=10) return; if (!tok||p.pred.toLowerCase().includes(tok)||p.desc.toLowerCase().includes(tok)) res.push({expr:pre+p.pred+']',pre,suf:H(p.pred)+']',desc:p.desc,page:false}); });
    return res.slice(0,8);
  }
  let lastSlash=-1,depth=0;
  for (let i=0;i<value.length;i++) { if(value[i]==='[')depth++;else if(value[i]===']')depth--;else if(value[i]==='/'&&depth===0)lastSlash=i; }
  if (lastSlash>=0) {
    const pre=value.substring(0,lastSlash+1),tok=value.substring(lastSlash+1).toLowerCase(),res=[];
    if (pageCtx?.topTags) pageCtx.topTags.forEach(({tag,count})=>{ if(res.length>=3)return; if(!tok||tag.startsWith(tok)) res.push({expr:pre+tag,pre,suf:tag,desc:tag+' ×'+count,page:true}); });
    STEPS.forEach(s=>{ if(res.length>=10||res.some(r=>r.expr===pre+s.step))return; if(!tok||s.step.toLowerCase().startsWith(tok)||s.step.toLowerCase().includes(tok)) res.push({expr:pre+s.step,pre,suf:H(s.step),desc:s.desc,page:false}); });
    return res.slice(0,9);
  }
  const q=value.toLowerCase(),res=[];
  if (pageCtx) {
    pageCtx.ids.forEach(id=>{ if(res.length>=2)return; if(id.toLowerCase().includes(q)) res.push({expr:'//*[@id="'+id+'"]',pre:'',suf:'//*[@id="'+H(id)+'"]',desc:'#'+id,page:true}); });
    pageCtx.classes.forEach(cls=>{ if(res.length>=4)return; if(cls.toLowerCase().includes(q)&&q.length>=2) res.push({expr:'//*[contains(@class,"'+cls+'")]',pre:'',suf:'//*[contains(@class,"'+H(cls)+'")]',desc:'.'+cls,page:true}); });
  }
  FULL.forEach(s=>{ if(res.length>=9)return; if(s.expr.toLowerCase().includes(q)||s.desc.toLowerCase().includes(q)) res.push({expr:s.expr,pre:'',suf:H(s.expr),desc:s.desc,page:false}); });
  return res.slice(0,8);
}

let selIdx=-1;
function showSuggestions(items) {
  selIdx=-1;
  if (!items.length) { suggestionsEl.classList.remove('visible'); return; }
  suggestionsEl.innerHTML = items.map((s,i)=>
    '<div class="sug-item" data-expr="'+H(s.expr)+'" data-i="'+i+'" style="padding:7px 10px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #1e2d45;">'
    +'<span style="font-family:monospace;font-size:12px;flex-shrink:0;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(s.pre?'<span style="color:#475569">'+H(s.pre)+'</span>':'')+'<span style="color:#FACC15">'+s.suf+'</span></span>'
    +'<span style="display:flex;align-items:center;gap:5px;flex-shrink:0;"><span style="color:#8094b0;font-size:11px;white-space:nowrap;">'+H(s.desc)+'</span>'+(s.page?'<span class="sug-badge">página</span>':'')+'</span>'
    +'</div>'
  ).join('');
  suggestionsEl.classList.add('visible');
}
function hideSuggestions() { suggestionsEl.classList.remove('visible'); selIdx=-1; }
function navSug(dir) {
  const items=suggestionsEl.querySelectorAll('.sug-item'); if(!items.length)return;
  items[selIdx]?.style.removeProperty('background');
  selIdx=(selIdx+dir+items.length)%items.length;
  items[selIdx].style.background='#1e2d45';
  input.value=items[selIdx].dataset.expr;
}
suggestionsEl.addEventListener('mousedown',e=>{
  const it=e.target.closest('.sug-item');
  if(it){input.value=it.dataset.expr;hideSuggestions();clearTimeout(autoTimer);autoEval(input.value);}
});

// ── Auto-run + live highlight ────────────────────────────────────
let autoTimer=null, liveHlActive=false;

async function clearLiveHighlight() {
  livePill.classList.remove('visible');
  if (!liveHlActive) return;
  try { const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); await chrome.tabs.sendMessage(tab.id,{action:'clearHighlights'}); } catch(e){}
  liveHlActive=false;
}

async function autoEval(xpath) {
  xpath=(xpath||'').trim();
  if (xpath.length<2) { clearLiveHighlight(); return; }
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}).catch(()=>{});
    const [result,hlRes]=await Promise.all([
      chrome.tabs.sendMessage(tab.id,{action:'evaluate',xpath}),
      chrome.tabs.sendMessage(tab.id,{action:'highlight',xpath})
    ]);
    renderResult(result);
    // Badge: show result count on extension icon
    const count = result.type === 'nodeset' ? result.count : (result.type === 'error' ? 0 : 1);
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: result.type === 'error' ? '#E63946' : '#FACC15' });
    chrome.action.setBadgeTextColor({ color: '#0F172A' });
    if (hlRes&&hlRes.highlighted>0) {
      liveHlActive=true; livePill.classList.add('visible');
      liveText.textContent=hlRes.highlighted+' nodo'+(hlRes.highlighted!==1?'s':'')+' resaltado'+(hlRes.highlighted!==1?'s':'');
    } else { livePill.classList.remove('visible'); }
  } catch(e) { livePill.classList.remove('visible'); }
}

input.addEventListener('input',()=>{
  const val=input.value;
  showSuggestions(getSuggestions(val));
  clearTimeout(autoTimer);
  if (val.trim().length>=2) autoTimer=setTimeout(()=>autoEval(val),500);
  else { clearLiveHighlight(); resultsWrap.innerHTML='<div class="result-empty"><div class="big">⟨/⟩</div>Escribe una expresión<br/>o elige un elemento arriba</div>'; }
});
input.addEventListener('blur',()=>setTimeout(hideSuggestions,150));
input.addEventListener('keydown',e=>{
  if (e.key==='ArrowDown'){e.preventDefault();navSug(1);return;}
  if (e.key==='ArrowUp'){e.preventDefault();navSug(-1);return;}
  if (e.key==='Tab'&&suggestionsEl.classList.contains('visible')){e.preventDefault();const f=suggestionsEl.querySelector('.sug-item');if(f){input.value=f.dataset.expr;hideSuggestions();}return;}
  if (e.key==='Enter'){clearTimeout(autoTimer);hideSuggestions();autoEval(input.value);}
  if (e.key==='Escape'){hideSuggestions();clearLiveHighlight();}
});

// ── Tabs & guide links ────────────────────────────────────────────
document.querySelectorAll('.guide-expr').forEach(el=>el.addEventListener('click',()=>{
  input.value=el.dataset.xpath;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab==='query'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-query'));
  clearTimeout(autoTimer); autoEval(input.value);
}));
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
}));

// ── Highlight toggle ──────────────────────────────────────────────
let hlActive=false;
hlBtn.addEventListener('click',async()=>{
  const xpath=input.value.trim(); if(!xpath)return;
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (hlActive) { await chrome.tabs.sendMessage(tab.id,{action:'clearHighlights'}); hlActive=false; hlBtn.classList.remove('active'); }
    else { await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}).catch(()=>{}); const res=await chrome.tabs.sendMessage(tab.id,{action:'highlight',xpath}); hlActive=true; hlBtn.classList.add('active'); hlBtn.title=res.highlighted+' nodos'; }
  } catch(e){}
});

// ── Clipboard & helpers ──────────────────────────────────────────
async function copyText(text,btn) {
  try { await navigator.clipboard.writeText(text); }
  catch(e) { const ta=Object.assign(document.createElement('textarea'),{value:text,style:'position:fixed;opacity:0'}); document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove(); }
  const orig=btn.textContent; btn.textContent='✓'; btn.style.color='#4ade80';
  setTimeout(()=>{btn.textContent=orig;btn.style.color='';},1500);
}
async function scrollToPage(idx) {
  try { const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); await chrome.tabs.sendMessage(tab.id,{action:'scrollTo',index:idx}); } catch(e){}
}
function nodeFullText(node) {
  if (node.nodeKind==='attr'||node.nodeKind==='text') return node.value||'';
  const a=Object.entries(node.attributes).map(([k,v])=>`@${k}="${v}"`).join(' ');
  return [`<${node.tag.toLowerCase()}>`,a&&`attrs: ${a}`,node.text&&`text: ${node.text}`,node.html&&`html: ${node.html}`].filter(Boolean).join('\n');
}

// ── Render ────────────────────────────────────────────────────────
function renderResult(result) {
  resultsWrap.innerHTML=''; input.classList.remove('error','success');
  if (!result) { renderError('Sin respuesta.'); return; }
  if (result.type==='error') { input.classList.add('error'); resultsWrap.innerHTML='<div class="error-box"><strong>⚠ Error XPath</strong>'+H(result.message)+'</div>'; return; }
  input.classList.add('success');
  const isSimple=result.type==='nodeset'&&result.nodes?.length>0&&result.nodes.every(n=>n.nodeKind==='attr'||n.nodeKind==='text');

  const sb=document.createElement('div'); sb.className='status-bar';
  sb.innerHTML='<span class="status-dot '+(( result.type==='nodeset'?result.count:1)>0?'ok':'warn')+'"></span><span class="status-label">'+(result.type==='nodeset'?result.count+' resultado'+(result.count!==1?'s':''):result.type)+'</span>';
  if (result.type==='nodeset'&&result.count>0) {
    const cb=document.createElement('button'); cb.className='copy-all-btn';
    cb.textContent=isSimple?'⎘ Copiar valores':'⎘ Copiar todo';
    cb.addEventListener('click',()=>copyText(isSimple?result.nodes.map(n=>n.value||'').join('\n'):result.nodes.map((n,i)=>'['+( i+1)+'] '+nodeFullText(n)).join('\n\n'),cb));
    sb.appendChild(cb);
  }
  if (['string','number','boolean'].includes(result.type)) {
    const cb=document.createElement('button'); cb.className='copy-all-btn'; cb.textContent='⎘ Copiar';
    cb.addEventListener('click',()=>copyText(String(result.value),cb)); sb.appendChild(cb);
  }
  resultsWrap.appendChild(sb);

  if (result.type==='nodeset') {
    if (result.count===0) { resultsWrap.insertAdjacentHTML('beforeend','<div class="result-empty"><div class="big">∅</div>Sin resultados</div>'); return; }
    result.nodes.forEach((node,i)=>{
      const item=document.createElement('div');
      item.style.cssText='margin-bottom:4px;border-radius:6px;overflow:hidden;border:1px solid #1e2d45;flex-shrink:0;';

      if (node.nodeKind==='attr'||node.nodeKind==='text') {
        item.innerHTML=
          '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0a1020;">'
          +'<span style="color:#8094b0;font-size:12px;min-width:22px;text-align:right;flex-shrink:0;">'+(i+1)+'</span>'
          +'<span style="color:#c084fc;font-size:12px;font-weight:600;flex-shrink:0;min-width:48px;">'+H(node.tag)+'</span>'
          +'<span style="color:#4ade80;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+H((node.value||'').substring(0,260))+'</span>'
          +'<button style="background:#1e2d45;border:1px solid #2d4060;border-radius:4px;color:#b8ccdf;font-size:11px;padding:4px 10px;cursor:pointer;flex-shrink:0;">⎘</button>'
          +'</div>';
        item.querySelector('button').addEventListener('click',function(){copyText(node.value||'',this);});

      } else {
        const nid=node.attributes.id?'#'+node.attributes.id:'';
        const cls=node.attributes.class?'.'+node.attributes.class.split(' ')[0]:'';
        const badge=(nid||cls)?'<span style="color:#c084fc;font-size:11px;background:rgba(192,132,252,.12);padding:1px 6px;border-radius:3px;flex-shrink:0;">'+H(nid||cls)+'</span>':'';
        const prev=(node.text||'').substring(0,80)+((node.text||'').length>80?'…':'');
        const hasAttrs=Object.keys(node.attributes).length>0;

        item.innerHTML=
          '<div class="el-hdr" style="display:flex;align-items:center;gap:7px;padding:9px 10px;background:#0a1020;cursor:pointer;">'
            +'<span style="color:#8094b0;font-size:12px;min-width:22px;text-align:right;flex-shrink:0;">'+(i+1)+'</span>'
            +'<span style="color:#FACC15;font-size:13px;font-weight:700;flex-shrink:0;">&lt;'+H(node.tag.toLowerCase())+'&gt;</span>'
            +badge
            +'<span style="color:#b8ccdf;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+H(prev)+'</span>'
            +'<span class="scroll-btn" title="Ir al elemento" style="color:#475569;font-size:13px;cursor:pointer;flex-shrink:0;padding:0 3px;transition:color .15s;">⌖</span>'
            +'<span class="chev" style="color:#8094b0;font-size:18px;flex-shrink:0;transition:transform .15s;">›</span>'
          +'</div>'
          +'<div class="el-body" style="display:none;border-top:1px solid #1e2d45;">'
            +(node.text?'<div style="display:flex;border-bottom:1px solid #1a2535;"><span style="color:#8094b0;font-size:11px;padding:7px 8px;min-width:56px;flex-shrink:0;border-right:1px solid #1a2535;background:#08101e;text-transform:uppercase;">texto</span><span style="color:#F8FAFC;font-size:13px;padding:6px 8px;flex:1;word-break:break-all;white-space:pre-wrap;max-height:80px;overflow-y:auto;">'+H(node.text.substring(0,300))+'</span><button class="cp" data-v="'+H(node.text.substring(0,300))+'" style="background:none;border:none;color:#8094b0;padding:6px 10px;cursor:pointer;font-size:14px;flex-shrink:0;align-self:center;">⎘</button></div>':'')
            +(hasAttrs?Object.entries(node.attributes).map(([k,v])=>'<div style="display:flex;border-bottom:1px solid #1a2535;"><span style="color:#c084fc;font-size:11px;padding:7px 8px;min-width:56px;flex-shrink:0;border-right:1px solid #1a2535;background:#08101e;word-break:break-all;">@'+H(k)+'</span><span style="color:#4ade80;font-size:13px;padding:6px 8px;flex:1;word-break:break-all;white-space:pre-wrap;max-height:80px;overflow-y:auto;">'+H(v.substring(0,160))+'</span><button class="cp" data-v="'+H(v)+'" style="background:none;border:none;color:#8094b0;padding:6px 10px;cursor:pointer;font-size:14px;flex-shrink:0;align-self:center;">⎘</button></div>').join(''):'')
            +'<div style="display:flex;border-bottom:1px solid #1a2535;"><span style="color:#8094b0;font-size:11px;padding:7px 8px;min-width:56px;flex-shrink:0;border-right:1px solid #1a2535;background:#08101e;text-transform:uppercase;">html</span><span style="color:#8094b0;font-size:11px;padding:6px 8px;flex:1;word-break:break-all;white-space:pre-wrap;max-height:80px;overflow-y:auto;">'+H((node.html||'').substring(0,400))+'</span><button class="cp" data-v="'+H(node.html||'')+'" style="background:none;border:none;color:#8094b0;padding:6px 10px;cursor:pointer;font-size:14px;flex-shrink:0;align-self:center;">⎘</button></div>'
            +'<div style="display:flex;gap:5px;padding:7px 10px;justify-content:flex-end;background:#08101e;">'
              +'<button class="act" data-type="node" style="background:#1e2d45;border:1px solid #2d4060;border-radius:4px;color:#b8ccdf;font-size:11px;padding:4px 10px;cursor:pointer;">⎘ Nodo</button>'
              +'<button class="act" data-type="text" style="background:#1e2d45;border:1px solid #2d4060;border-radius:4px;color:#b8ccdf;font-size:11px;padding:4px 10px;cursor:pointer;">⎘ Texto</button>'
              +'<button class="act" data-type="html" style="background:#1e2d45;border:1px solid #2d4060;border-radius:4px;color:#b8ccdf;font-size:11px;padding:4px 10px;cursor:pointer;">⎘ HTML</button>'
            +'</div>'
          +'</div>';

        const hdr=item.querySelector('.el-hdr');
        const body=item.querySelector('.el-body');
        const chev=item.querySelector('.chev');
        const scrollSpan=item.querySelector('.scroll-btn');
        scrollSpan.addEventListener('mouseenter',()=>scrollSpan.style.color='#FACC15');
        scrollSpan.addEventListener('mouseleave',()=>scrollSpan.style.color='#475569');
        scrollSpan.addEventListener('click',e=>{e.stopPropagation();scrollToPage(i);});
        hdr.addEventListener('click',()=>{const open=body.style.display==='block';body.style.display=open?'none':'block';chev.style.transform=open?'':'rotate(90deg)';scrollToPage(i);});
        item.querySelectorAll('button.cp').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();copyText(btn.dataset.v,btn);}));
        item.querySelectorAll('button.act').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const v=btn.dataset.type==='node'?nodeFullText(node):btn.dataset.type==='text'?(node.text||''):(node.html||'');copyText(v,btn);}));
      }
      resultsWrap.appendChild(item);
    });
  } else {
    const labels={number:'Número',string:'Texto',boolean:'Booleano'};
    resultsWrap.insertAdjacentHTML('beforeend','<div style="background:#1e2d45;border:1px solid #2d4060;border-radius:6px;padding:16px;font-size:16px;color:#4ade80;text-align:center;flex-shrink:0;"><div style="font-size:11px;color:#8094b0;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">'+(labels[result.type]||result.type)+'</div>'+H(String(result.value))+'</div>');
  }
}

function renderError(msg) { resultsWrap.innerHTML='<div class="error-box"><strong>⚠ Error</strong>'+H(msg)+'</div>'; }

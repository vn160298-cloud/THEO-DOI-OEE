/* =====================================================================
   THEO DÕI OEE — Ứng dụng ghi nhận vận hành thiết bị hằng ngày (PWA)
   Frontend thuần HTML/CSS/JS — không cần build, không cần server riêng.
   Dữ liệu lưu trên Google Sheets thông qua Google Apps Script Web App.
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------- hằng số */
const K = {
  cfg:'oee.apiUrl', token:'oee.token', user:'oee.user',
  master:'oee.master', draft:'oee.draft', outbox:'oee.outbox', lastMachine:'oee.lastMachine'
};
const ROLE = { op:'Vận hành', leader:'Tổ trưởng', tech:'Kỹ thuật' };
const LEVEL_NAME = { 1:'Cấp 1 — Nhập liệu', 2:'Cấp 2 — Nhập liệu & theo dõi', 3:'Cấp 3 — Toàn quyền dữ liệu' };

const state = {
  apiUrl: '', token:'', user:null, master:null,
  view:'entry', draft:null, installEvent:null,
  today:{ general:[], downtime:[] }, report:null, masterTab:'machines', masterMachine:''
};

/* ---------------------------------------------------------------- tiện ích */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const ls = {
  get(k, d=null){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};
const noAccent = s => String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().trim();
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x'+Date.now()+Math.random().toString(36).slice(2,8));

/* số: 1234567 -> "1.234.567" */
const fmtNum = n => {
  if(n===''||n==null||isNaN(n)) return '';
  const neg = Number(n)<0; const s = String(Math.abs(Math.round(Number(n))));
  return (neg?'-':'') + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};
const parseNum = v => { const s = String(v==null?'':v).replace(/[^\d-]/g,''); return s===''||s==='-' ? null : Number(s); };
const pct = v => v==null||!isFinite(v) ? '—' : (v*100).toFixed(1)+'%';

const todayStr = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const dStr = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const dmy  = s => { const p=String(s||'').split('-'); return p.length===3 ? `${p[2]}/${p[1]}/${p[0]}` : (s||''); };

/* số phút giữa 2 giờ HH:MM (tự xử lý ca qua đêm) */
function minutesBetween(a, b){
  const pa=/^(\d{1,2}):(\d{2})/.exec(a||''), pb=/^(\d{1,2}):(\d{2})/.exec(b||'');
  if(!pa||!pb) return null;
  let m1=+pa[1]*60+ +pa[2], m2=+pb[1]*60+ +pb[2];
  if(m2 <= m1) m2 += 24*60;
  return m2-m1;
}

/* ---------------------------------------------------------------- UI chung */
let toastTimer;
function toast(msg, kind=''){
  const t = $('#toast'); t.textContent = msg; t.className = 'toast '+kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.classList.add('hidden'), 2600);
}
const busy = on => $('#loading').classList.toggle('hidden', !on);

function openOverlay(id){ $(id).classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeOverlay(id){
  $(id).classList.add('hidden');
  /* chỉ mở lại cuộn trang khi không còn lớp phủ nào (picker có thể mở từ trong modal) */
  const open = ['#picker','#modal','#menu'].some(s => !$(s).classList.contains('hidden'));
  if(!open) document.body.style.overflow = '';
}

/* ---- Picker: danh sách sổ xuống kèm tra cứu nhanh ---- */
let pickerCtx = null;
function openPicker(opt){
  pickerCtx = opt;
  $('#picker-title').textContent = opt.title || 'Chọn';
  $('#picker-search').value = '';
  $('#picker-search').placeholder = opt.searchPlaceholder || 'Tìm nhanh…';
  renderPicker('');
  openOverlay('#picker');
  if(!('ontouchstart' in window)) setTimeout(()=> $('#picker-search').focus(), 60);
}
function renderPicker(q){
  const o = pickerCtx; if(!o) return;
  const nq = noAccent(q);
  let items = o.items.filter(it => !nq || noAccent(it.label).includes(nq) || noAccent(it.code).includes(nq) || noAccent(it.sub).includes(nq));
  let html = '';
  if(o.note) html += `<div class="p-note">${esc(o.note)}</div>`;
  if(o.allowClear !== false) html += `<div class="p-item" data-i="-1"><div><div class="p-l muted">— Bỏ chọn —</div></div></div>`;
  if(!items.length) html += `<div class="empty">Không tìm thấy. ${o.emptyHint||''}</div>`;
  let lastGroup = null;
  items.forEach(it => {
    if(it.group && it.group !== lastGroup){ lastGroup = it.group; html += `<div class="p-group">${esc(it.group)}</div>`; }
    html += `<div class="p-item ${it.value===o.value?'sel':''}" data-v="${esc(it.value)}">
      <div><div class="p-l">${esc(it.label)}</div>${it.sub?`<div class="p-s">${esc(it.sub)}</div>`:''}</div>
      ${it.code?`<span class="p-code">${esc(it.code)}</span>`:''}</div>`;
  });
  $('#picker-list').innerHTML = html;
}
$('#picker-search').addEventListener('input', e => renderPicker(e.target.value));
$('#picker-close').addEventListener('click', ()=> closeOverlay('#picker'));
$('#picker').addEventListener('click', e => { if(e.target.id==='picker') closeOverlay('#picker'); });
$('#picker-list').addEventListener('click', e => {
  const el = e.target.closest('.p-item'); if(!el || !pickerCtx) return;
  const v = el.dataset.i === '-1' ? '' : el.dataset.v;
  const item = pickerCtx.items.find(x => x.value === v) || null;
  closeOverlay('#picker');
  pickerCtx.onPick(v, item);
});

/* ---- Modal biểu mẫu ---- */
let modalCtx = null;
function openModal(title, bodyHtml, onOk, okLabel){
  modalCtx = { onOk };
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-ok').textContent = okLabel || 'Lưu';
  $('#modal-ok').classList.toggle('hidden', !onOk);
  openOverlay('#modal');
}
$('#modal-close').addEventListener('click', ()=> closeOverlay('#modal'));
$('#modal-cancel').addEventListener('click', ()=> closeOverlay('#modal'));
$('#modal-ok').addEventListener('click', ()=> { if(modalCtx && modalCtx.onOk) modalCtx.onOk(); });
/* gắn 1 lần, các biểu mẫu bên trong modal đăng ký qua modalCtx.onInput / onClick */
$('#modal-body').addEventListener('input', e => { if(modalCtx && modalCtx.onInput) modalCtx.onInput(e); });
$('#modal-body').addEventListener('click', e => { if(modalCtx && modalCtx.onClick) modalCtx.onClick(e); });

/* ---------------------------------------------------------------- gọi API */
async function api(action, payload){
  if(!state.apiUrl) throw new Error('Chưa cấu hình đường dẫn API');
  const res = await fetch(state.apiUrl, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.token, payload: payload||{} })
  });
  if(!res.ok) throw new Error('Máy chủ trả về lỗi '+res.status);
  let json;
  try{ json = await res.json(); }
  catch(e){ throw new Error('Đường dẫn API không đúng hoặc chưa cấp quyền "Anyone"'); }
  if(!json.ok){
    if(json.code === 'AUTH'){ logout(true); throw new Error('Phiên đăng nhập đã hết, vui lòng đăng nhập lại'); }
    throw new Error(json.error || 'Lỗi không xác định');
  }
  return json.data;
}

/* ---------------------------------------------------------------- master */
function activeOf(list){ return (list||[]).filter(r => r.active !== false); }

function machines(){ return activeOf(state.master && state.master.machines); }
function machineByCode(c){ return machines().find(m => m.code === c) || null; }
function shifts(){ return activeOf(state.master && state.master.shifts); }
function units(){ return activeOf(state.master && state.master.units); }
function presets(){ return activeOf(state.master && state.master.presets); }
function statuses(){ return activeOf(state.master && state.master.statuses); }
function issues(){ return activeOf(state.master && state.master.issues); }

/* mã lỗi lọc theo máy */
function errorsFor(machineCode){
  const all = activeOf(state.master && state.master.errors);
  return all.filter(e => !e.machine || e.machine==='*' || e.machine===machineCode);
}
/* nhân sự lọc theo vai trò + ca + máy */
function staffFor(role, shift, machineCode){
  const all = activeOf(state.master && state.master.staff).filter(s => s.role === role);
  const match = all.filter(s =>
    (!s.shift   || s.shift==='*'   || !shift       || s.shift === shift) &&
    (!s.machine || s.machine==='*' || !machineCode || s.machine === machineCode));
  return { list: match.length ? match : all, filtered: match.length>0, total: all.length };
}
/* sản phẩm lọc theo máy */
function productsFor(machineCode){
  const all = activeOf(state.master && state.master.products);
  const match = all.filter(p => !p.machine || p.machine==='*' || p.machine===machineCode);
  return match.length ? match : all;
}
/* công suất lý thuyết SP/giờ: ưu tiên theo sản phẩm, sau đó theo máy */
function rateOf(machineCode, productCode){
  const p = activeOf(state.master && state.master.products).find(x => x.code===productCode && (!x.machine || x.machine===machineCode || x.machine==='*'));
  if(p && Number(p.rate) > 0) return Number(p.rate);
  const m = machineByCode(machineCode);
  return m && Number(m.rate) > 0 ? Number(m.rate) : 0;
}
function limitsOf(machineCode, productCode){
  const p = activeOf(state.master && state.master.products).find(x => x.code===productCode && (!x.machine || x.machine===machineCode || x.machine==='*'));
  if(!p) return { min:null, max:null };
  return { min: Number(p.min)>0?Number(p.min):null, max: Number(p.max)>0?Number(p.max):null };
}

async function syncMaster(silent){
  try{
    const m = await api('master');
    state.master = m; ls.set(K.master, m);
    if(!silent) toast('Đã cập nhật dữ liệu nền', 'ok');
    return true;
  }catch(e){
    if(!silent) toast(e.message, 'bad');
    return false;
  }
}

/* ---------------------------------------------------------------- OEE */
function calcOEE(t){
  const planned = minutesBetween(t.start, t.end);
  const down = Number(t.downtime||0);
  const qty = Number(t.qty||0), def = Number(t.defect||0);
  const oper = planned==null ? null : Math.max(planned - down, 0);
  const A = (planned && planned>0) ? oper/planned : null;
  const Q = qty>0 ? Math.max(qty-def,0)/qty : null;
  const rate = rateOf(t.machine, t.product);
  const Praw = (rate>0 && oper>0) ? qty / (rate/60*oper) : null;
  /* P vượt 100% nghĩa là công suất lý thuyết cấu hình thấp hơn thực tế -> chặn ở 100% */
  const P = Praw==null ? null : Math.min(Praw, 1);
  const OEE = (A!=null && P!=null && Q!=null) ? A*P*Q : null;
  return { planned, down, oper, A, P, Praw, Q, OEE, rate, over: Praw!=null && Praw > 1.02 };
}
const gradeOf = v => v==null ? '' : (v>=0.85?'good' : v>=0.6?'warn':'bad');
function kpiCard(label, value, sub, grade){
  return `<div class="kpi ${grade||''}"><div class="k-l">${esc(label)}</div>
    <div class="k-v">${value}</div>${sub?`<div class="k-s">${esc(sub)}</div>`:''}</div>`;
}

/* =====================================================================
   NHẬP PHIẾU
   ===================================================================== */
const blankDraft = () => ({
  machine:'', machineName:'', date: todayStr(), shift:'', operator:'', leader:'', tech:'',
  product:'', qty:'', unit:'', defect:'', start:'', end:'', note:'',
  dts:[ blankDt() ]
});
const blankDt = () => ({ code:'', reason:'', minutes:'', quality:'', handler:'', status:'', note:'' });

function loadDraft(){
  const d = ls.get(K.draft);
  state.draft = (d && typeof d==='object' && Array.isArray(d.dts)) ? d : blankDraft();
  if(!state.draft.date) state.draft.date = todayStr();
  if(!state.draft.dts.length) state.draft.dts.push(blankDt());
}
let draftTimer;
function saveDraft(){
  clearTimeout(draftTimer);
  draftTimer = setTimeout(()=>{
    ls.set(K.draft, state.draft);
    /* cờ "đang lưu nháp": chỉ xét những ô người nhập tự điền cho từng phiếu
       (máy/ca/ngày/giờ/đơn vị/tổ trưởng/kỹ thuật được giữ lại cho phiếu kế tiếp) */
    const d = state.draft;
    const dirty = !!(d.operator || d.product || d.qty!=='' || d.defect!=='' || d.note ||
      d.dts.some(r => r.code || r.minutes!=='' || r.quality || r.handler || r.status || r.note));
    $('#draft-flag').classList.toggle('hidden', !dirty);
  }, 250);
}

function setPickerBtn(sel, text, ph){
  const b = $(sel);
  b.textContent = text || ph || b.dataset.ph || 'Chọn';
  b.classList.toggle('ph', !text);
}

function renderEntry(){
  const d = state.draft;
  const m = machineByCode(d.machine);
  setPickerBtn('#f-machine', m ? m.name : '');
  $('#f-machine-code').value = m ? m.code : '';
  $('#f-date').value  = d.date || todayStr();
  setPickerBtn('#f-shift',    d.shift);
  setPickerBtn('#f-operator', d.operator);
  setPickerBtn('#f-leader',   d.leader);
  setPickerBtn('#f-tech',     d.tech);
  setPickerBtn('#f-product',  d.product);
  setPickerBtn('#f-unit',     d.unit);
  $('#f-qty').value    = fmtNum(d.qty);
  $('#f-defect').value = fmtNum(d.defect);
  $('#f-start').value  = d.start || '';
  $('#f-end').value    = d.end || '';
  $('#f-note').value   = d.note || '';
  renderQtyHint();
  renderDtList();
  renderEntryOEE();
  saveDraft();
}

function renderQtyHint(){
  const d = state.draft, lim = limitsOf(d.machine, d.product), q = parseNum(d.qty);
  const el = $('#f-qty-hint'); el.className = 'hint';
  if(lim.min==null && lim.max==null){ el.textContent = d.product ? '' : 'Chọn mã sản phẩm để áp giới hạn sản lượng'; return; }
  const range = `Giới hạn: ${lim.min!=null?fmtNum(lim.min):'0'} – ${lim.max!=null?fmtNum(lim.max):'∞'}`;
  if(q!=null && ((lim.min!=null && q<lim.min) || (lim.max!=null && q>lim.max))){
    el.className = 'hint bad'; el.textContent = 'Sản lượng ngoài giới hạn! '+range;
  } else el.textContent = range;
}

function renderDtList(){
  const d = state.draft;
  $('#dt-list').innerHTML = d.dts.map((r,i) => {
    const err = errorsFor(d.machine).find(e => e.code === r.code);
    const label = r.code ? `${r.code} — ${r.reason || (err?err.name:'')}` : '';
    return `<div class="dt-row" data-i="${i}">
      <div class="dt-row-head"><b>Lần dừng ${i+1}</b>
        ${d.dts.length>1?`<button class="dt-del" data-del="${i}">Xóa</button>`:''}</div>
      <div class="form-grid">
        <div class="fld full"><span>Lý do dừng máy (mã lỗi)</span>
          <button type="button" class="picker ${label?'':'ph'}" data-pick="code" data-i="${i}">${esc(label||'Chọn mã lỗi / lý do')}</button></div>
        <div class="fld"><span>Thời gian dừng (phút)</span>
          <input inputmode="numeric" class="num" data-f="minutes" data-i="${i}" value="${esc(r.minutes)}" placeholder="0"></div>
        <div class="fld"><span>Tình trạng lỗi</span>
          <button type="button" class="picker ${r.status?'':'ph'}" data-pick="status" data-i="${i}">${esc(r.status||'Chọn tình trạng')}</button></div>
        <div class="fld"><span>Vấn đề chất lượng</span>
          <button type="button" class="picker ${r.quality?'':'ph'}" data-pick="quality" data-i="${i}">${esc(r.quality||'Chọn / bỏ trống')}</button></div>
        <div class="fld"><span>Người xử lý lỗi</span>
          <button type="button" class="picker ${r.handler?'':'ph'}" data-pick="handler" data-i="${i}">${esc(r.handler||'Chọn người xử lý')}</button></div>
        <div class="fld full"><span>Ghi chú</span>
          <input data-f="note" data-i="${i}" value="${esc(r.note)}" placeholder="Ghi chú lần dừng này…"></div>
      </div></div>`;
  }).join('');
  $('#dt-total').textContent = fmtNum(d.dts.reduce((s,r)=> s + (parseNum(r.minutes)||0), 0));
}

function renderEntryOEE(){
  const d = state.draft;
  const t = { machine:d.machine, product:d.product, start:d.start, end:d.end,
    qty:parseNum(d.qty)||0, defect:parseNum(d.defect)||0,
    downtime: d.dts.reduce((s,r)=> s+(parseNum(r.minutes)||0), 0) };
  const c = calcOEE(t);
  $('#entry-oee').innerHTML =
    kpiCard('OEE', pct(c.OEE), c.rate?'':'chưa có công suất', gradeOf(c.OEE)) +
    kpiCard('Khả dụng (A)', pct(c.A), c.planned!=null?`${fmtNum(c.oper)}/${fmtNum(c.planned)} phút`:'nhập giờ', gradeOf(c.A)) +
    kpiCard('Hiệu suất (P)', pct(c.P), c.over?'vượt công suất cấu hình':(c.rate?`${fmtNum(c.rate)} SP/giờ`:'—'), gradeOf(c.P)) +
    kpiCard('Chất lượng (Q)', pct(c.Q), t.qty?`lỗi ${fmtNum(t.defect)}`:'nhập sản lượng', gradeOf(c.Q));
}

/* ---- sự kiện form thông tin chung ---- */
$('#f-machine').addEventListener('click', ()=> openPicker({
  title:'Tra cứu nhanh — Tên máy', value: state.draft.machine,
  items: machines().map(m => ({ value:m.code, label:m.name, code:m.code, sub:m.rate?`${fmtNum(m.rate)} SP/giờ`:'' })),
  onPick(v){
    const d = state.draft; d.machine = v; d.machineName = (machineByCode(v)||{}).name || '';
    ls.set(K.lastMachine, v);
    /* đổi máy: bỏ chọn những mục không còn phù hợp */
    if(d.product && !productsFor(v).some(p=>p.code===d.product)) d.product='';
    d.dts.forEach(r => { if(r.code && !errorsFor(v).some(e=>e.code===r.code)){ r.code=''; r.reason=''; } });
    revalidateStaff();
    renderEntry();
  }
}));
$('#f-shift').addEventListener('click', ()=> openPicker({
  title:'Tra cứu nhanh — Ca làm việc', value: state.draft.shift,
  items: shifts().map(s => ({ value:s.name, label:s.name, sub:(s.start&&s.end)?`${s.start} – ${s.end}`:'' })),
  onPick(v, it){
    const d = state.draft; d.shift = v;
    const s = shifts().find(x=>x.name===v);
    if(s && s.start && !d.start) d.start = s.start;
    if(s && s.end && !d.end) d.end = s.end;
    revalidateStaff(); renderEntry();
  }
}));
function revalidateStaff(){
  const d = state.draft;
  const chk = (role, val) => { const r = staffFor(role, d.shift, d.machine); return r.list.some(s=>s.name===val); };
  if(d.operator && !chk(ROLE.op, d.operator)) d.operator = '';
  if(d.leader && !chk(ROLE.leader, d.leader)) d.leader = '';
  if(d.tech && !chk(ROLE.tech, d.tech)) d.tech = '';
  /* tự chọn nếu chỉ có 1 lựa chọn hợp lệ */
  const auto = (role, key) => { const r = staffFor(role, d.shift, d.machine); if(!d[key] && r.filtered && r.list.length===1) d[key] = r.list[0].name; };
  if(d.shift && d.machine){ auto(ROLE.op,'operator'); auto(ROLE.leader,'leader'); auto(ROLE.tech,'tech'); }
}
function staffPicker(role, key, title){
  const d = state.draft;
  const r = staffFor(role, d.shift, d.machine);
  openPicker({
    title, value: d[key],
    items: r.list.map(s => ({ value:s.name, label:s.name, sub:[s.shift&&s.shift!=='*'?s.shift:'', s.machine&&s.machine!=='*'?s.machine:''].filter(Boolean).join(' · ') })),
    emptyHint: r.total ? '' : 'Chưa có nhân sự trong danh mục — nhờ Cấp 3 thêm ở tab Dữ liệu.',
    note: (d.shift && d.machine && !r.filtered && r.total)
      ? 'Chưa gán ai cho ' + d.shift + ' · ' + d.machine + ' — đang hiển thị toàn bộ danh sách.' : '',
    onPick(v){ d[key] = v; renderEntry(); }
  });
}
$('#f-operator').addEventListener('click', ()=> staffPicker(ROLE.op,'operator','Người vận hành'+(state.draft.shift?` — ${state.draft.shift}`:'')));
$('#f-leader').addEventListener('click',   ()=> staffPicker(ROLE.leader,'leader','Tổ trưởng'+(state.draft.shift?` — ${state.draft.shift}`:'')));
$('#f-tech').addEventListener('click',     ()=> staffPicker(ROLE.tech,'tech','Kỹ thuật'+(state.draft.shift?` — ${state.draft.shift}`:'')));

$('#f-product').addEventListener('click', ()=> openPicker({
  title:'Tra cứu nhanh — Mã sản phẩm', value: state.draft.product,
  items: productsFor(state.draft.machine).map(p => ({
    value:p.code, label:p.name || p.code, code:p.code,
    sub:[ (p.min||p.max)?`SL ${p.min?fmtNum(p.min):'0'}–${p.max?fmtNum(p.max):'∞'}`:'', p.rate?`${fmtNum(p.rate)} SP/giờ`:'' ].filter(Boolean).join(' · ')
  })),
  emptyHint:'Chưa có mã sản phẩm — nhờ Cấp 3 thêm ở tab Dữ liệu.',
  onPick(v){ state.draft.product = v; renderEntry(); }
}));
$('#f-unit').addEventListener('click', ()=> openPicker({
  title:'Tra cứu nhanh — Đơn vị tính sản lượng', value: state.draft.unit,
  items: units().map(u => ({ value:u.name, label:u.name })),
  onPick(v){ state.draft.unit = v; renderEntry(); }
}));
$('#f-qty-pick').addEventListener('click', ()=> openPicker({
  title:'Chọn nhanh sản lượng', value: String(state.draft.qty||''),
  items: presets().map(p => ({ value:String(p.value), label:fmtNum(p.value) })),
  emptyHint:'Chưa có danh sách gợi ý — Quản trị thêm ở tab Dữ liệu → Sản lượng gợi ý.',
  onPick(v){ state.draft.qty = v ? parseNum(v) : ''; renderEntry(); }
}));

/* nhập số có dấu chấm phân cách */
function bindNumInput(sel, key){
  $(sel).addEventListener('input', e => {
    const n = parseNum(e.target.value);
    state.draft[key] = n==null ? '' : n;
    const pos = e.target.selectionStart, before = e.target.value.length;
    e.target.value = fmtNum(n);
    const after = e.target.value.length;
    try{ e.target.setSelectionRange(Math.max(0,pos+(after-before)), Math.max(0,pos+(after-before))); }catch(_){}
    renderQtyHint(); renderEntryOEE(); saveDraft();
  });
}
bindNumInput('#f-qty','qty');
bindNumInput('#f-defect','defect');
['date','start','end'].forEach(k => $('#f-'+k).addEventListener('change', e => {
  state.draft[k] = e.target.value; renderEntryOEE(); saveDraft();
}));
$('#f-note').addEventListener('input', e => { state.draft.note = e.target.value; saveDraft(); });

/* ---- sự kiện nhật ký dừng máy ---- */
$('#btn-add-dt').addEventListener('click', ()=> { state.draft.dts.push(blankDt()); renderDtList(); saveDraft(); });
$('#dt-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if(del){ state.draft.dts.splice(+del.dataset.del,1); if(!state.draft.dts.length) state.draft.dts.push(blankDt()); renderDtList(); renderEntryOEE(); saveDraft(); return; }
  const pk = e.target.closest('[data-pick]'); if(!pk) return;
  const i = +pk.dataset.i, row = state.draft.dts[i], d = state.draft;
  if(pk.dataset.pick === 'code'){
    if(!d.machine) return toast('Chọn tên máy trước để tra bảng mã lỗi', 'bad');
    openPicker({
      title:`Bảng tra mã lỗi — ${(machineByCode(d.machine)||{}).name||d.machine}`, value: row.code,
      items: errorsFor(d.machine).map(x => ({ value:x.code, label:x.name, code:x.code })),
      emptyHint:'Máy này chưa có mã lỗi trong danh mục.',
      onPick(v, it){ row.code = v; row.reason = it ? it.label : ''; renderDtList(); saveDraft(); }
    });
  } else if(pk.dataset.pick === 'status'){
    openPicker({ title:'Tình trạng lỗi', value:row.status,
      items: statuses().map(s => ({ value:s.name, label:s.name })),
      onPick(v){ row.status = v; renderDtList(); saveDraft(); } });
  } else if(pk.dataset.pick === 'quality'){
    openPicker({ title:'Vấn đề chất lượng', value:row.quality,
      items: issues().map(s => ({ value:s.name, label:s.name })),
      onPick(v){ row.quality = v; renderDtList(); saveDraft(); } });
  } else if(pk.dataset.pick === 'handler'){
    const tech = staffFor(ROLE.tech, d.shift, d.machine).list;
    const ops  = staffFor(ROLE.op, d.shift, d.machine).list;
    const lead = staffFor(ROLE.leader, d.shift, d.machine).list;
    const items = [].concat(
      tech.map(s=>({value:s.name,label:s.name,group:'Kỹ thuật'})),
      lead.map(s=>({value:s.name,label:s.name,group:'Tổ trưởng'})),
      ops.map(s=>({value:s.name,label:s.name,group:'Vận hành'})));
    openPicker({ title:'Người xử lý lỗi', value:row.handler, items,
      onPick(v){ row.handler = v; renderDtList(); saveDraft(); } });
  }
});
$('#dt-list').addEventListener('input', e => {
  const el = e.target.closest('[data-f]'); if(!el) return;
  const row = state.draft.dts[+el.dataset.i], f = el.dataset.f;
  if(f === 'minutes'){ const n = parseNum(el.value); row.minutes = n==null?'':n; el.value = fmtNum(n);
    $('#dt-total').textContent = fmtNum(state.draft.dts.reduce((s,r)=> s+(parseNum(r.minutes)||0),0)); renderEntryOEE(); }
  else row[f] = el.value;
  saveDraft();
});
$('#btn-lookup-err').addEventListener('click', ()=>{
  const d = state.draft;
  if(!d.machine) return toast('Chọn tên máy trước', 'bad');
  openPicker({ title:`Bảng tra mã lỗi — ${(machineByCode(d.machine)||{}).name||d.machine}`, allowClear:false, value:'',
    items: errorsFor(d.machine).map(x => ({ value:x.code, label:x.name, code:x.code })),
    onPick(){} });
});

/* ---- lưu phiếu ---- */
$('#btn-clear').addEventListener('click', ()=>{
  openModal('Xóa nháp?', '<p>Toàn bộ dữ liệu đang nhập sẽ bị xóa. Bạn chắc chắn?</p>', ()=>{
    state.draft = blankDraft(); ls.del(K.draft); closeOverlay('#modal'); renderEntry(); toast('Đã xóa nháp');
  }, 'Xóa');
});

$('#btn-save').addEventListener('click', saveTicket);

async function saveTicket(){
  const d = state.draft;
  const err = [];
  if(!d.machine) err.push('Tên máy');
  if(!d.date) err.push('Ngày');
  if(!d.shift) err.push('Ca');
  if(!d.operator) err.push('Người vận hành');
  if(parseNum(d.qty)==null) err.push('Tổng sản lượng');
  if(!d.start) err.push('Giờ bắt đầu');
  if(!d.end) err.push('Giờ kết thúc');
  if(err.length) return toast('Thiếu: '+err.join(', '), 'bad');

  const qty = parseNum(d.qty)||0, def = parseNum(d.defect)||0;
  if(def > qty) return toast('Sản lượng lỗi không thể lớn hơn tổng sản lượng', 'bad');
  const lim = limitsOf(d.machine, d.product);
  if((lim.min!=null && qty<lim.min) || (lim.max!=null && qty>lim.max))
    return toast(`Sản lượng phải trong khoảng ${lim.min!=null?fmtNum(lim.min):0} – ${lim.max!=null?fmtNum(lim.max):'∞'}`, 'bad');

  const dts = d.dts.filter(r => r.code || parseNum(r.minutes) || r.note || r.quality || r.handler || r.status);
  for(const r of dts){ if(!parseNum(r.minutes)) return toast('Nhập thời gian dừng (phút) cho mỗi lần dừng máy', 'bad'); }

  const m = machineByCode(d.machine) || {};
  const planned = minutesBetween(d.start, d.end) || 0;
  const down = dts.reduce((s,r)=> s+(parseNum(r.minutes)||0), 0);
  if(down > planned) return toast('Tổng phút dừng lớn hơn thời gian làm việc — kiểm tra lại', 'bad');

  const ticket = {
    id: uid(),
    general: {
      date:d.date, shift:d.shift, machine:d.machine, machineName:m.name||'', product:d.product,
      operator:d.operator, leader:d.leader, tech:d.tech,
      qty, unit:d.unit, defect:def, start:d.start, end:d.end,
      planned, downtime:down, stops:dts.length, note:d.note
    },
    downtimes: dts.map((r,i) => ({
      seq:i+1, code:r.code, reason:r.reason, minutes:parseNum(r.minutes)||0,
      quality:r.quality, handler:r.handler, status:r.status, note:r.note
    }))
  };

  busy(true);
  try{
    await api('saveTicket', ticket);
    afterSaved('Đã lưu thành công!');
  }catch(e){
    /* mất mạng / lỗi tạm thời -> xếp hàng chờ gửi */
    if(!navigator.onLine || /Failed to fetch|NetworkError|Load failed|timeout/i.test(e.message)){
      const out = ls.get(K.outbox, []); out.push(ticket); ls.set(K.outbox, out);
      afterSaved('Đã lưu tạm — sẽ tự gửi khi có mạng');
    } else toast(e.message, 'bad');
  }finally{ busy(false); updateSyncChip(); }
}
function afterSaved(msg){
  const keep = { machine: state.draft.machine, machineName: state.draft.machineName,
                 shift: state.draft.shift, date: state.draft.date, unit: state.draft.unit };
  state.draft = Object.assign(blankDraft(), keep);   /* giữ máy/ca/ngày cho phiếu kế tiếp */
  ls.del(K.draft);
  const sh = shifts().find(x => x.name === state.draft.shift);
  if(sh){ state.draft.start = sh.start || ''; state.draft.end = sh.end || ''; }
  revalidateStaff();
  renderEntry();
  toast(msg, 'ok');
  window.scrollTo({ top:0, behavior:'smooth' });
}

/* ---- outbox ---- */
async function flushOutbox(silent){
  let out = ls.get(K.outbox, []);
  if(!out.length){ if(!silent) toast('Không có phiếu nào đang chờ'); return; }
  if(!navigator.onLine){ if(!silent) toast('Chưa có mạng', 'bad'); return; }
  busy(!silent);
  let sent = 0;
  for(const t of out.slice()){
    try{ await api('saveTicket', t); out = out.filter(x => x.id !== t.id); ls.set(K.outbox, out); sent++; }
    catch(e){ break; }
  }
  busy(false); updateSyncChip();
  if(sent) toast(`Đã gửi ${sent} phiếu chờ lên Google Sheets`, 'ok');
  else if(!silent) toast('Chưa gửi được, thử lại sau', 'bad');
}
function updateSyncChip(){
  const n = ls.get(K.outbox, []).length, chip = $('#sync-chip');
  if(!navigator.onLine){ chip.textContent = 'Offline'; chip.className = 'chip err'; }
  else if(n){ chip.textContent = n+' chờ'; chip.className = 'chip off'; }
  else { chip.textContent = 'Đã đồng bộ'; chip.className = 'chip on'; }
  $('#menu-outbox').textContent = n;
}
window.addEventListener('online',  ()=> { updateSyncChip(); flushOutbox(true); });
window.addEventListener('offline', updateSyncChip);
$('#sync-chip').addEventListener('click', ()=> flushOutbox());

/* =====================================================================
   PHIẾU TRONG NGÀY
   ===================================================================== */
async function loadToday(){
  const date = $('#today-date').value || todayStr();
  busy(true);
  try{
    const data = await api('tickets', { from:date, to:date });
    state.today = data; renderToday();
  }catch(e){ toast(e.message,'bad'); }
  finally{ busy(false); }
}
function renderToday(){
  const g = state.today.general || [], dt = state.today.downtime || [];
  const qty = g.reduce((s,r)=>s+Number(r.qty||0),0), def = g.reduce((s,r)=>s+Number(r.defect||0),0);
  const down = dt.reduce((s,r)=>s+Number(r.minutes||0),0);
  const oees = g.map(r => calcOEE(r).OEE).filter(v => v!=null);
  const avg = oees.length ? oees.reduce((a,b)=>a+b,0)/oees.length : null;
  $('#today-kpi').innerHTML =
    kpiCard('Số phiếu', fmtNum(g.length)) +
    kpiCard('Tổng sản lượng', fmtNum(qty)) +
    kpiCard('Sản lượng lỗi', fmtNum(def), qty?pct(def/qty):'', def/Math.max(qty,1)>0.03?'bad':'') +
    kpiCard('Phút dừng', fmtNum(down), dt.length+' lần') +
    kpiCard('OEE bình quân', pct(avg), '', gradeOf(avg));

  /* trạng thái xử lý lỗi theo máy */
  const byM = {};
  dt.forEach(r => {
    const k = r.machine || '—';
    byM[k] = byM[k] || { name:r.machineName||k, total:0, minutes:0, st:{} };
    byM[k].total++; byM[k].minutes += Number(r.minutes||0);
    const s = r.status || 'Chưa ghi';
    byM[k].st[s] = (byM[k].st[s]||0)+1;
  });
  const keys = Object.keys(byM);
  $('#today-status').innerHTML = keys.length ? keys.map(k => {
    const v = byM[k];
    const chips = Object.entries(v.st).map(([s,n]) => {
      const ns = noAccent(s);
      const cls = /da xu ly|xong|hoan thanh|ok/.test(ns) ? 'badge-ok' : /dang/.test(ns) ? 'badge-warn' : 'badge-bad';
      return `<span class="badge ${cls}">${esc(s)}: ${n}</span>`;
    }).join(' ');
    return `<div class="item"><div class="item-head">
        <div><div class="item-title">${esc(v.name)}</div><div class="item-sub">${v.total} lần dừng · ${fmtNum(v.minutes)} phút</div></div>
        <span class="badge">${esc(k)}</span></div>
      <div style="margin-top:6px">${chips}</div></div>`;
  }).join('') : `<div class="empty">Không có lần dừng máy nào được ghi nhận.</div>`;

  /* danh sách phiếu */
  $('#today-list').innerHTML = g.length ? g.map(r => {
    const c = calcOEE(r);
    const rows = dt.filter(x => x.ticket === r.id);
    return `<div class="item">
      <div class="item-head">
        <div><div class="item-title">${esc(r.machineName||r.machine)}</div>
          <div class="item-sub">${esc(r.shift)} · ${esc(r.start)}–${esc(r.end)} · ${esc(r.operator||'')}</div></div>
        <span class="badge ${gradeOf(c.OEE)==='good'?'badge-ok':gradeOf(c.OEE)==='warn'?'badge-warn':gradeOf(c.OEE)==='bad'?'badge-bad':''}">OEE ${pct(c.OEE)}</span>
      </div>
      <div class="kv">
        <i>Sản lượng</i><span>${fmtNum(r.qty)} ${esc(r.unit||'')} · lỗi ${fmtNum(r.defect)}</span>
        <i>Dừng máy</i><span>${fmtNum(r.downtime)} phút / ${rows.length} lần</span>
        <i>A / P / Q</i><span>${pct(c.A)} · ${pct(c.P)} · ${pct(c.Q)}</span>
        ${r.product?`<i>Sản phẩm</i><span>${esc(r.product)}</span>`:''}
        ${r.note?`<i>Ghi chú</i><span>${esc(r.note)}</span>`:''}
      </div>
      ${rows.length?`<details style="margin-top:8px"><summary class="item-sub">Xem ${rows.length} lần dừng máy</summary>
        <div class="scroll-x"><table class="tbl"><tr><th>#</th><th>Mã lỗi</th><th>Lý do</th><th class="n">Phút</th><th>Tình trạng</th><th>Người xử lý</th></tr>
        ${rows.map(x=>`<tr><td>${esc(x.seq)}</td><td>${esc(x.code)}</td><td>${esc(x.reason)}</td>
          <td class="n">${fmtNum(x.minutes)}</td><td>${esc(x.status||'')}</td><td>${esc(x.handler||'')}</td></tr>`).join('')}
        </table></div></details>`:''}
    </div>`;
  }).join('') : `<div class="empty">Chưa có phiếu nào trong ngày ${dmy($('#today-date').value)}.</div>`;
}
$('#today-reload').addEventListener('click', loadToday);
$('#today-date').addEventListener('change', loadToday);

/* =====================================================================
   TỔNG QUAN (khoảng thời gian tự chọn + OEE từng máy)
   ===================================================================== */
function setRange(kind){
  const now = new Date(); let from = new Date(), to = new Date();
  if(kind==='today'){}
  else if(kind==='7'){ from.setDate(now.getDate()-6); }
  else if(kind==='30'){ from.setDate(now.getDate()-29); }
  else if(kind==='month'){ from = new Date(now.getFullYear(), now.getMonth(), 1); }
  else if(kind==='lastmonth'){ from = new Date(now.getFullYear(), now.getMonth()-1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
  else if(kind==='year'){ from = new Date(now.getFullYear(), 0, 1); }
  $('#rp-from').value = dStr(from); $('#rp-to').value = dStr(to);
  $$('#range-presets .chip-btn').forEach(b => b.classList.toggle('active', b.dataset.range===kind));
}
$('#range-presets').addEventListener('click', e => {
  const b = e.target.closest('.chip-btn'); if(!b) return;
  setRange(b.dataset.range); loadReport();
});
$('#rp-run').addEventListener('click', loadReport);
$('#rp-machine').addEventListener('click', ()=> openPicker({
  title:'Chọn máy', value: state.rpMachine||'',
  items: machines().map(m=>({value:m.code,label:m.name,code:m.code})),
  onPick(v){ state.rpMachine = v; setPickerBtn('#rp-machine', v?(machineByCode(v)||{}).name:''); loadReport(); }
}));
$('#rp-shift').addEventListener('click', ()=> openPicker({
  title:'Chọn ca', value: state.rpShift||'',
  items: shifts().map(s=>({value:s.name,label:s.name})),
  onPick(v){ state.rpShift = v; setPickerBtn('#rp-shift', v); loadReport(); }
}));

async function loadReport(){
  const from = $('#rp-from').value, to = $('#rp-to').value;
  if(!from || !to) return toast('Chọn khoảng thời gian', 'bad');
  if(from > to) return toast('"Từ ngày" phải trước "Đến ngày"', 'bad');
  busy(true);
  try{
    const data = await api('tickets', { from, to });
    state.report = data; renderReport();
  }catch(e){ toast(e.message,'bad'); }
  finally{ busy(false); }
}
function renderReport(){
  let g = (state.report.general||[]).slice(), dt = (state.report.downtime||[]).slice();
  if(state.rpMachine){ g = g.filter(r=>r.machine===state.rpMachine); dt = dt.filter(r=>r.machine===state.rpMachine); }
  if(state.rpShift){ g = g.filter(r=>r.shift===state.rpShift); dt = dt.filter(r=>r.shift===state.rpShift); }

  const agg = rows => {
    let planned=0, down=0, qty=0, def=0, ideal=0, hasRate=false;
    rows.forEach(r => {
      const c = calcOEE(r);
      planned += c.planned||0; down += Number(r.downtime||0);
      qty += Number(r.qty||0); def += Number(r.defect||0);
      if(c.rate>0){ hasRate = true; ideal += (c.rate/60) * Math.max((c.planned||0)-Number(r.downtime||0),0); }
    });
    const oper = Math.max(planned-down,0);
    const A = planned>0 ? oper/planned : null;
    const Q = qty>0 ? Math.max(qty-def,0)/qty : null;
    const Praw = hasRate && ideal>0 ? qty/ideal : null;
    const P = Praw==null ? null : Math.min(Praw, 1);
    return { planned, down, oper, qty, def, A, P, Praw, Q, over:Praw!=null&&Praw>1.02,
             OEE:(A!=null&&P!=null&&Q!=null)?A*P*Q:null, n:rows.length };
  };
  const all = agg(g);
  $('#rp-kpi').innerHTML =
    kpiCard('OEE', pct(all.OEE), all.n+' phiếu', gradeOf(all.OEE)) +
    kpiCard('Khả dụng A', pct(all.A), fmtNum(all.down)+' phút dừng', gradeOf(all.A)) +
    kpiCard('Hiệu suất P', pct(all.P), '', gradeOf(all.P)) +
    kpiCard('Chất lượng Q', pct(all.Q), 'lỗi '+fmtNum(all.def), gradeOf(all.Q)) +
    kpiCard('Tổng sản lượng', fmtNum(all.qty)) +
    kpiCard('Giờ làm việc', fmtNum(Math.round(all.planned/60)), fmtNum(all.planned)+' phút');

  /* OEE theo máy */
  const byM = {};
  g.forEach(r => { (byM[r.machine] = byM[r.machine] || { name:r.machineName||r.machine, rows:[] }).rows.push(r); });
  const list = Object.entries(byM).map(([code,v]) => ({ code, name:v.name, a:agg(v.rows) }))
    .sort((x,y) => (y.a.OEE==null?-1:y.a.OEE) - (x.a.OEE==null?-1:x.a.OEE));
  $('#rp-machines').innerHTML = list.length ? list.map(m => `
    <div class="item"><div class="item-head">
      <div><div class="item-title">${esc(m.name)}</div>
        <div class="item-sub">${m.a.n} phiếu · SL ${fmtNum(m.a.qty)} · dừng ${fmtNum(m.a.down)} phút</div></div>
      <div style="text-align:right"><div class="item-title">${pct(m.a.OEE)}</div><div class="item-sub">${esc(m.code)}</div></div>
    </div>
    <div class="bar"><i class="${gradeOf(m.a.OEE)}" style="width:${Math.min((m.a.OEE||0)*100,100)}%"></i></div>
    <div class="item-sub" style="margin-top:5px">A ${pct(m.a.A)} · P ${pct(m.a.P)} · Q ${pct(m.a.Q)}${m.a.P==null?' · <b>chưa cấu hình công suất máy</b>':(m.a.over?' · <b>sản lượng vượt công suất cấu hình</b>':'')}</div>
  </div>`).join('') : `<div class="empty">Không có dữ liệu trong khoảng đã chọn.</div>`;

  /* Pareto nguyên nhân dừng */
  const byR = {};
  dt.forEach(r => { const k = (r.code?r.code+' — ':'')+(r.reason||'Không ghi lý do');
    byR[k] = byR[k] || { m:0, n:0 }; byR[k].m += Number(r.minutes||0); byR[k].n++; });
  const par = Object.entries(byR).sort((a,b)=>b[1].m-a[1].m).slice(0,12);
  const max = par.length ? par[0][1].m : 1;
  $('#rp-pareto').innerHTML = par.length ? par.map(([k,v]) => `
    <div style="margin-bottom:9px">
      <div class="item-head"><div class="item-sub" style="color:var(--text);font-weight:600">${esc(k)}</div>
        <div class="item-sub">${fmtNum(v.m)}′ / ${v.n} lần</div></div>
      <div class="bar"><i style="width:${(v.m/max*100).toFixed(0)}%"></i></div>
    </div>`).join('') : `<div class="empty">Không có lần dừng máy nào.</div>`;

  /* Xu hướng theo ngày */
  const byD = {};
  g.forEach(r => { (byD[r.date] = byD[r.date] || []).push(r); });
  const days = Object.keys(byD).sort();
  $('#rp-trend').innerHTML = days.length ? `<div class="scroll-x"><table class="tbl">
    <tr><th>Ngày</th><th class="n">Phiếu</th><th class="n">Sản lượng</th><th class="n">Lỗi</th><th class="n">Phút dừng</th><th class="n">OEE</th></tr>
    ${days.map(d => { const a = agg(byD[d]); return `<tr><td>${dmy(d)}</td><td class="n">${a.n}</td>
      <td class="n">${fmtNum(a.qty)}</td><td class="n">${fmtNum(a.def)}</td><td class="n">${fmtNum(a.down)}</td>
      <td class="n"><b>${pct(a.OEE)}</b></td></tr>`; }).join('')}
    </table></div>` : `<div class="empty">Không có dữ liệu.</div>`;
}

/* =====================================================================
   DỮ LIỆU NỀN (Cấp 3)
   ===================================================================== */
const MASTER_DEFS = {
  machines: { title:'Máy', sheet:'May',
    fields:[ {k:'code',l:'Mã máy',req:1}, {k:'name',l:'Tên máy',req:1}, {k:'rate',l:'Công suất lý thuyết (SP/giờ)',type:'num'} ],
    label:r=>r.name||r.code, sub:r=>`${r.code}${r.rate?' · '+fmtNum(r.rate)+' SP/giờ':' · chưa có công suất'}` },
  errors: { title:'Mã lỗi', sheet:'MaLoi',
    fields:[ {k:'machine',l:'Máy áp dụng',type:'machine'}, {k:'code',l:'Mã lỗi',req:1}, {k:'name',l:'Tên lỗi / lý do dừng',req:1} ],
    label:r=>r.name, sub:r=>(!r.machine||r.machine==='*')?'Dùng cho tất cả máy':'', code:r=>r.code,
    machineFilter:true, groupBy:'machine', sortBy:'code' },
  shifts: { title:'Ca làm việc', sheet:'Ca',
    fields:[ {k:'name',l:'Tên ca',req:1}, {k:'start',l:'Giờ bắt đầu',type:'time'}, {k:'end',l:'Giờ kết thúc',type:'time'} ],
    label:r=>r.name, sub:r=>(r.start&&r.end)?`${r.start} – ${r.end}`:'' },
  staff: { title:'Nhân sự', sheet:'NhanSu',
    fields:[ {k:'role',l:'Vai trò',type:'role',req:1}, {k:'name',l:'Họ tên',req:1},
             {k:'shift',l:'Ca',type:'shift'}, {k:'machine',l:'Máy',type:'machine'} ],
    label:r=>r.name, sub:r=>[r.role, r.shift&&r.shift!=='*'?r.shift:'mọi ca', r.machine&&r.machine!=='*'?r.machine:'mọi máy'].join(' · '),
    machineFilter:true, groupBy:'role' },
  products: { title:'Sản phẩm & giới hạn', sheet:'SanPham',
    fields:[ {k:'code',l:'Mã sản phẩm',req:1}, {k:'name',l:'Tên sản phẩm'}, {k:'machine',l:'Máy',type:'machine'},
             {k:'min',l:'Sản lượng tối thiểu',type:'num'}, {k:'max',l:'Sản lượng tối đa',type:'num'},
             {k:'rate',l:'Công suất (SP/giờ) — để trống nếu dùng của máy',type:'num'} ],
    label:r=>r.code+(r.name?' — '+r.name:''),
    sub:r=>`SL ${r.min?fmtNum(r.min):0}–${r.max?fmtNum(r.max):'∞'}${r.rate?' · '+fmtNum(r.rate)+' SP/giờ':''}`,
    machineFilter:true, groupBy:'machine' },
  units: { title:'Đơn vị sản lượng', sheet:'DonVi', fields:[ {k:'name',l:'Đơn vị tính',req:1} ], label:r=>r.name, sub:()=>'' },
  presets:{ title:'Sản lượng gợi ý', sheet:'SanLuongGoiY', fields:[ {k:'value',l:'Giá trị sản lượng',type:'num',req:1} ], label:r=>fmtNum(r.value), sub:()=>'' },
  statuses:{ title:'Tình trạng lỗi', sheet:'TinhTrangLoi', fields:[ {k:'name',l:'Tình trạng',req:1} ], label:r=>r.name, sub:()=>'' },
  issues: { title:'Vấn đề chất lượng', sheet:'VanDeChatLuong', fields:[ {k:'name',l:'Vấn đề chất lượng',req:1} ], label:r=>r.name, sub:()=>'' }
};

function renderMasterTabs(){
  $('#master-tabs').innerHTML = Object.entries(MASTER_DEFS)
    .map(([k,d]) => `<button class="chip-btn ${k===state.masterTab?'active':''}" data-mt="${k}">${d.title}</button>`).join('');
}
$('#master-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-mt]'); if(!b) return;
  state.masterTab = b.dataset.mt; $('#master-search').value=''; renderMasterTabs(); renderMasterList();
});

/* bộ lọc theo máy (dùng cho Mã lỗi, Nhân sự, Sản phẩm) */
function setMasterMachine(code){
  state.masterMachine = code || '';
  const m = code ? machineByCode(code) : null;
  const btn = $('#master-machine');
  btn.textContent = m ? m.name : (code || 'Tất cả máy');
  btn.classList.toggle('ph', !code);
}
$('#master-machine').addEventListener('click', ()=> openPicker({
  title:'Lọc theo máy', value: state.masterMachine || '',
  items: machines().map(m => {
    const n = (state.master[state.masterTab]||[]).filter(r => r.machine === m.code).length;
    return { value:m.code, label:m.name, code:m.code, sub: n ? n + ' mục' : 'chưa có mục nào' };
  }),
  onPick(v){ setMasterMachine(v); renderMasterList(); }
}));
$('#master-search').addEventListener('input', renderMasterList);

function renderMasterList(){
  const key = state.masterTab, def = MASTER_DEFS[key];
  $('#master-title').textContent = def.title;
  $('#master-filter').classList.toggle('hidden', !def.machineFilter);
  if(def.machineFilter) setMasterMachine(state.masterMachine);

  const all = (state.master[key]||[]);
  const q = noAccent($('#master-search').value);
  const mf = def.machineFilter ? state.masterMachine : '';
  let rows = all.slice();
  /* lọc theo máy: giữ cả mục dùng chung cho mọi máy (máy = * hoặc trống) */
  if(mf) rows = rows.filter(r => r.machine === mf || r.machine === '*' || !r.machine);
  if(q) rows = rows.filter(r => noAccent(Object.values(r).join(' ')).includes(q));

  const cmp = (a,b) => String(a==null?'':a).localeCompare(String(b==null?'':b), 'vi', { numeric:true });
  const gval = r => def.groupBy ? String(r[def.groupBy]||'') : '';
  rows.sort((a,b) => (def.groupBy ? cmp(gval(a), gval(b)) : 0)
    || cmp(def.sortBy ? a[def.sortBy] : def.label(a), def.sortBy ? b[def.sortBy] : def.label(b)));

  /* dòng đếm + gợi ý bối cảnh */
  const total = mf ? all.filter(r => r.machine === mf).length : all.length;
  $('#master-count').innerHTML = mf
    ? `Đang xem <b>${esc((machineByCode(mf)||{}).name || mf)}</b> — ${total} mục riêng của máy này
       · <a href="#" data-clear-mf>xem tất cả máy</a>`
    : (def.machineFilter ? `Tất cả ${all.length} mục của ${machines().length} máy — chọn máy ở trên để xem riêng` : '');

  if(!rows.length){
    $('#master-list').innerHTML = `<div class="empty">${q ? 'Không tìm thấy mục nào.'
      : mf ? 'Máy này chưa có mục nào. Bấm “+ Thêm” để tạo cho máy đang chọn.'
           : 'Chưa có dữ liệu. Bấm “+ Thêm” để tạo mới.'}</div>`;
    return;
  }

  /* gom nhóm theo máy khi đang xem tất cả máy */
  const groupByMachine = def.groupBy === 'machine' && !mf;
  const showGroups = def.groupBy && !(def.groupBy === 'machine' && mf);
  let html = '', last = null;
  rows.forEach(r => {
    const g = gval(r);
    if(showGroups && g !== last){
      last = g;
      const n = rows.filter(x => gval(x) === g).length;
      const title = groupByMachine
        ? ((machineByCode(g)||{}).name || (g === '*' || !g ? 'Dùng cho tất cả máy' : g))
        : (g || '—');
      html += `<div class="m-group"><b>${esc(title)}</b>
        <span>${groupByMachine && g && g!=='*' ? esc(g) + ' · ' : ''}${n} mục</span></div>`;
    }
    const code = def.code ? def.code(r) : '';
    const sub = def.sub(r);
    html += `<div class="item">
      <div class="item-head">
        <div><div class="item-title">${esc(def.label(r))} ${r.active===false?'<span class="badge badge-warn">tắt</span>':''}</div>
          ${sub?`<div class="item-sub">${esc(sub)}</div>`:''}</div>
        <div class="item-actions">
          ${code?`<span class="p-code">${esc(code)}</span>`:''}
          <button class="mini" data-edit="${esc(r.id)}">Sửa</button>
          <button class="mini danger" data-del="${esc(r.id)}">Xóa</button>
        </div></div></div>`;
  });
  $('#master-list').innerHTML = html;
}
$('#master-count').addEventListener('click', e => {
  if(!e.target.closest('[data-clear-mf]')) return;
  e.preventDefault(); setMasterMachine(''); renderMasterList();
});
$('#master-add').addEventListener('click', ()=> {
  const def = MASTER_DEFS[state.masterTab];
  /* đang lọc theo máy nào thì thêm mục mới cho đúng máy đó */
  masterForm(def.machineFilter && state.masterMachine ? { machine: state.masterMachine } : null);
});
$('#master-list').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
  const rows = state.master[state.masterTab]||[];
  if(ed) masterForm(rows.find(r=>r.id===ed.dataset.edit));
  if(dl){
    const row = rows.find(r=>r.id===dl.dataset.del); if(!row) return;
    openModal('Xóa dữ liệu?', `<p>Xóa <b>${esc(MASTER_DEFS[state.masterTab].label(row))}</b> khỏi danh mục <b>${MASTER_DEFS[state.masterTab].title}</b>?</p>
      <p class="muted small">Các phiếu đã lưu trên Google Sheets không bị ảnh hưởng.</p>`, async ()=>{
      closeOverlay('#modal'); busy(true);
      try{ await api('masterDelete', { sheet:MASTER_DEFS[state.masterTab].sheet, id:row.id });
        await syncMaster(true); renderMasterList(); toast('Đã xóa','ok'); }
      catch(err){ toast(err.message,'bad'); } finally{ busy(false); }
    }, 'Xóa');
  }
});

/* form thêm/sửa dữ liệu nền */
let mfState = null;
function masterForm(row){
  const def = MASTER_DEFS[state.masterTab];
  mfState = Object.assign({ id:'', active:true }, row||{});
  const body = def.fields.map(f => {
    const v = mfState[f.k]==null?'':mfState[f.k];
    if(f.type==='machine'||f.type==='shift'||f.type==='role'){
      /* trường Máy lưu mã máy nhưng hiển thị tên máy cho dễ đọc */
      const disp = (f.type==='machine' && v) ? ((machineByCode(v)||{}).name || v) : v;
      return `<div class="fld"><span>${f.l}${f.req?' <b class="req">*</b>':''}</span>
        <button type="button" class="picker ${v?'':'ph'}" data-mf="${f.k}" data-t="${f.type}">${esc(disp||(f.type==='machine'?'Tất cả máy':f.type==='shift'?'Tất cả ca':'Chọn vai trò'))}</button></div>`;
    }
    const it = f.type==='time' ? 'time' : 'text';
    const im = f.type==='num' ? ' inputmode="numeric"' : '';
    return `<label class="fld"><span>${f.l}${f.req?' <b class="req">*</b>':''}</span>
      <input type="${it}"${im} data-mf="${f.k}" value="${esc(f.type==='num'?fmtNum(v):v)}" class="${f.type==='num'?'num':''}"></label>`;
  }).join('') + `<label class="fld" style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" data-mf="active" ${mfState.active!==false?'checked':''} style="width:auto"> <span style="margin:0">Đang sử dụng</span></label>`;

  openModal(((row && row.id)?'Sửa ':'Thêm ')+def.title, body, async ()=>{
    const out = { id: mfState.id || '', active: mfState.active !== false };
    for(const f of def.fields){
      let v = mfState[f.k]==null?'':String(mfState[f.k]).trim();
      if(f.type==='num'){ const n = parseNum(v); v = n==null?'':n; }
      if(f.req && (v===''||v==null)) return toast('Thiếu: '+f.l, 'bad');
      out[f.k] = v;
    }
    closeOverlay('#modal'); busy(true);
    try{
      await api('masterUpsert', { sheet:def.sheet, row:out });
      await syncMaster(true); renderMasterList(); toast('Đã lưu','ok');
    }catch(e){ toast(e.message,'bad'); } finally{ busy(false); }
  });

  modalCtx.onInput = e => {
    const el = e.target.closest('[data-mf]'); if(!el) return;
    const k = el.dataset.mf;
    if(el.type==='checkbox') mfState[k] = el.checked;
    else if(el.classList.contains('num')){ const n = parseNum(el.value); mfState[k] = n==null?'':n; el.value = fmtNum(n); }
    else mfState[k] = el.value;
  };
  modalCtx.onClick = e => {
    const el = e.target.closest('[data-mf][data-t]'); if(!el) return;
    const k = el.dataset.mf, t = el.dataset.t;
    const items = t==='machine' ? machines().map(m=>({value:m.code,label:m.name,code:m.code}))
      : t==='shift' ? shifts().map(s=>({value:s.name,label:s.name}))
      : Object.values(ROLE).map(r=>({value:r,label:r}));
    const ph = t==='machine' ? 'Tất cả máy' : t==='shift' ? 'Tất cả ca' : 'Chọn vai trò';
    openPicker({ title: t==='machine'?'Chọn máy':t==='shift'?'Chọn ca':'Chọn vai trò',
      value:mfState[k]||'', items, onPick(v, item){
        mfState[k] = v;
        el.textContent = v ? (item ? item.label : v) : ph;
        el.classList.toggle('ph', !v);
      }});
  };
}

/* =====================================================================
   NGƯỜI DÙNG (chỉ Quản trị)
   ===================================================================== */
async function loadUsers(){
  busy(true);
  try{ state.users = await api('usersList'); renderUsers(); }
  catch(e){ toast(e.message,'bad'); } finally{ busy(false); }
}
function renderUsers(){
  const rows = state.users||[];
  $('#users-list').innerHTML = rows.length ? rows.map(u => `
    <div class="item"><div class="item-head">
      <div><div class="item-title">${esc(u.fullname||u.username)} ${u.active===false?'<span class="badge badge-warn">tắt</span>':''}
        ${u.admin?'<span class="badge badge-ok">Quản trị</span>':''}</div>
        <div class="item-sub">${esc(u.username)} · ${esc(LEVEL_NAME[u.level]||('Cấp '+u.level))}</div></div>
      <div class="item-actions">
        <button class="mini" data-uedit="${esc(u.id)}">Sửa</button>
        <button class="mini danger" data-udel="${esc(u.id)}">Xóa</button>
      </div></div></div>`).join('') : `<div class="empty">Chưa có tài khoản nào.</div>`;
}
$('#user-add').addEventListener('click', ()=> userForm(null));
$('#users-list').addEventListener('click', e => {
  const ed = e.target.closest('[data-uedit]'), dl = e.target.closest('[data-udel]');
  if(ed) userForm((state.users||[]).find(u=>u.id===ed.dataset.uedit));
  if(dl){
    const u = (state.users||[]).find(x=>x.id===dl.dataset.udel); if(!u) return;
    openModal('Xóa tài khoản?', `<p>Xóa tài khoản <b>${esc(u.username)}</b>?</p>`, async ()=>{
      closeOverlay('#modal'); busy(true);
      try{ await api('userDelete',{id:u.id}); await loadUsers(); toast('Đã xóa','ok'); }
      catch(err){ toast(err.message,'bad'); } finally{ busy(false); }
    }, 'Xóa');
  }
});
let ufState = null;
function userForm(u){
  ufState = Object.assign({ id:'', username:'', fullname:'', password:'', level:1, admin:false, active:true }, u||{});
  const body = `
    <label class="fld"><span>Tên đăng nhập <b class="req">*</b></span>
      <input data-uf="username" value="${esc(ufState.username)}" autocapitalize="none" spellcheck="false" ${u?'readonly':''}></label>
    <label class="fld"><span>Họ tên</span><input data-uf="fullname" value="${esc(ufState.fullname)}"></label>
    <label class="fld"><span>Mật khẩu ${u?'<small class="muted">(để trống nếu không đổi)</small>':'<b class="req">*</b>'}</span>
      <input data-uf="password" type="text" placeholder="${u?'••••••':'Nhập mật khẩu'}"></label>
    <div class="fld"><span>Cấp độ <b class="req">*</b></span>
      <button type="button" class="picker" data-uf-level>${esc(LEVEL_NAME[ufState.level]||'Chọn cấp độ')}</button></div>
    <label class="fld" style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" data-uf="admin" ${ufState.admin?'checked':''} style="width:auto"><span style="margin:0">Quản trị (được tạo tài khoản)</span></label>
    <label class="fld" style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" data-uf="active" ${ufState.active!==false?'checked':''} style="width:auto"><span style="margin:0">Đang sử dụng</span></label>`;
  openModal((u?'Sửa ':'Thêm ')+'tài khoản', body, async ()=>{
    if(!ufState.username) return toast('Thiếu tên đăng nhập','bad');
    if(!u && !ufState.password) return toast('Thiếu mật khẩu','bad');
    closeOverlay('#modal'); busy(true);
    try{ await api('userUpsert', ufState); await loadUsers(); toast('Đã lưu','ok'); }
    catch(e){ toast(e.message,'bad'); } finally{ busy(false); }
  });
  modalCtx.onInput = e => {
    const el = e.target.closest('[data-uf]'); if(!el) return;
    ufState[el.dataset.uf] = el.type==='checkbox' ? el.checked : el.value;
  };
  modalCtx.onClick = e => {
    if(!e.target.closest('[data-uf-level]')) return;
    openPicker({ title:'Cấp độ truy cập', value:String(ufState.level), allowClear:false,
      items:[1,2,3].map(l=>({value:String(l),label:LEVEL_NAME[l]})),
      onPick(v){ ufState.level = Number(v); $('#modal-body [data-uf-level]').textContent = LEVEL_NAME[v]; } });
  };
}

/* =====================================================================
   MENU / ĐĂNG NHẬP / ĐIỀU HƯỚNG
   ===================================================================== */
const TABS = [
  { key:'entry',  label:'Nhập phiếu', icon:'📝', title:'Nhập phiếu',      min:1 },
  { key:'today',  label:'Hôm nay',    icon:'📋', title:'Phiếu trong ngày', min:2 },
  { key:'report', label:'Tổng quan',  icon:'📊', title:'Tổng quan OEE',    min:2 },
  { key:'master', label:'Dữ liệu',    icon:'🗂️', title:'Dữ liệu nền',      min:3 },
  { key:'users',  label:'Người dùng', icon:'👤', title:'Người dùng',       admin:true }
];
function visibleTabs(){
  const u = state.user||{level:1};
  return TABS.filter(t => t.admin ? !!u.admin : (u.level>=t.min));
}
function renderTabs(){
  $('#tabbar').innerHTML = visibleTabs().map(t =>
    `<button data-tab="${t.key}" class="${t.key===state.view?'active':''}"><span class="ti">${t.icon}</span>${t.label}</button>`).join('');
}
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if(b) showView(b.dataset.tab); });

function showView(key){
  if(!visibleTabs().some(t=>t.key===key)) key = 'entry';
  state.view = key;
  ['entry','today','report','master','users'].forEach(k => $('#view-'+k).classList.toggle('hidden', k!==key));
  $('#view-title').textContent = (TABS.find(t=>t.key===key)||{}).title || '';
  $('.actions-sticky').classList.toggle('hidden', key!=='entry');
  renderTabs();
  window.scrollTo(0,0);
  if(key==='today'){ if(!$('#today-date').value) $('#today-date').value = todayStr(); loadToday(); }
  if(key==='report'){ if(!$('#rp-from').value) setRange('7'); if(!state.report) loadReport(); }
  if(key==='master'){ renderMasterTabs(); renderMasterList(); }
  if(key==='users'){ loadUsers(); }
}

/* ---- menu ---- */
$('#btn-menu').addEventListener('click', ()=>{
  $('#menu-name').textContent = (state.user||{}).fullname || (state.user||{}).username || '';
  $('#menu-level').textContent = (state.user||{}).admin ? 'Quản trị — toàn quyền' : (LEVEL_NAME[(state.user||{}).level]||'');
  updateSyncChip(); openOverlay('#menu');
});
$('#menu').addEventListener('click', async e => {
  if(e.target.id==='menu') return closeOverlay('#menu');
  const b = e.target.closest('.menu-item'); if(!b) return;
  closeOverlay('#menu');
  const act = b.dataset.act;
  if(act==='sync'){ busy(true); await syncMaster(); busy(false); if(state.view==='master') renderMasterList(); renderEntry(); }
  if(act==='push') flushOutbox();
  if(act==='logout') openModal('Đăng xuất?', '<p>Phiếu nháp và phiếu đang chờ gửi vẫn được giữ trên máy.</p>', ()=>{ closeOverlay('#modal'); logout(); }, 'Đăng xuất');
  if(act==='pass') passForm();
  if(act==='install') installHelp();
  if(act==='about') openModal('Phiên bản & cập nhật', `
    <p><b>Phiên bản:</b> ${esc(window.APP_CONFIG.APP_VERSION||'1.0.0')}</p>
    <p><b>API:</b><br><span class="small muted" style="word-break:break-all">${esc(state.apiUrl)}</span></p>
    <p class="small muted">Khi có bản cập nhật: đóng hẳn app rồi mở lại 2 lần, hoặc bấm nút bên dưới.
    Dữ liệu trên Google Sheets và phiếu nháp trên máy <b>không bị ảnh hưởng</b> khi cập nhật.</p>
    <button class="btn btn-ghost btn-block" onclick="forceUpdate()">Tải lại bản mới nhất</button>`, null);
});
function passForm(){
  let cur='', nw='';
  openModal('Đổi mật khẩu', `
    <label class="fld"><span>Mật khẩu hiện tại</span><input type="password" id="pw-cur"></label>
    <label class="fld"><span>Mật khẩu mới</span><input type="password" id="pw-new"></label>`, async ()=>{
    cur = $('#pw-cur').value; nw = $('#pw-new').value;
    if(!cur || !nw) return toast('Nhập đủ 2 ô','bad');
    if(nw.length < 4) return toast('Mật khẩu mới quá ngắn','bad');
    closeOverlay('#modal'); busy(true);
    try{ await api('changePassword',{ current:cur, next:nw }); toast('Đã đổi mật khẩu','ok'); }
    catch(e){ toast(e.message,'bad'); } finally{ busy(false); }
  });
}
function installHelp(){
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if(state.installEvent){
    state.installEvent.prompt();
    state.installEvent = null;
    return;
  }
  openModal('Cài lên màn hình chính', ios ? `
    <p><b>iPhone / iPad (Safari)</b></p>
    <ol class="small"><li>Mở app này bằng <b>Safari</b>.</li>
    <li>Bấm nút <b>Chia sẻ</b> (hình vuông có mũi tên lên) ở thanh dưới.</li>
    <li>Chọn <b>Thêm vào MH chính / Add to Home Screen</b>.</li>
    <li>Bấm <b>Thêm</b>. Mở app từ icon vừa tạo — sẽ chạy toàn màn hình, không có thanh địa chỉ.</li></ol>` : `
    <p><b>Android (Chrome)</b></p>
    <ol class="small"><li>Bấm nút <b>⋮</b> góc trên phải Chrome.</li>
    <li>Chọn <b>Cài đặt ứng dụng / Thêm vào Màn hình chính</b>.</li>
    <li>Xác nhận <b>Cài đặt</b>. Mở từ icon vừa tạo — chạy toàn màn hình.</li></ol>`, null);
}
window.forceUpdate = async function(){
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if(window.caches){ const ks = await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }
  }catch(e){}
  location.reload();
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installEvent = e; });

/* ---- đăng nhập / đăng xuất ---- */
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const u = $('#login-user').value.trim(), p = $('#login-pass').value;
  if(!u || !p) return;
  $('#login-msg').textContent = ''; busy(true); $('#login-btn').disabled = true;
  try{
    const r = await api('login', { username:u, password:p });
    state.token = r.token; state.user = r.user;
    ls.set(K.token, r.token); ls.set(K.user, r.user);
    $('#login-pass').value = '';
    await enterApp(true);
  }catch(err){ $('#login-msg').textContent = err.message; }
  finally{ busy(false); $('#login-btn').disabled = false; }
});
$('#login-reconfig').addEventListener('click', ()=>{ showScreen('setup'); $('#setup-url').value = state.apiUrl; });

function logout(silent){
  state.token=''; state.user=null;
  ls.del(K.token); ls.del(K.user);
  showScreen('login');
  if(!silent) toast('Đã đăng xuất');
}

/* ---- màn hình ---- */
function showScreen(s){
  $('#screen-setup').classList.toggle('hidden', s!=='setup');
  $('#screen-login').classList.toggle('hidden', s!=='login');
  $('#app').classList.toggle('hidden', s!=='app');
  document.body.style.overflow = '';
}
async function enterApp(fresh){
  showScreen('app');
  $('#user-line').textContent = ((state.user||{}).fullname || (state.user||{}).username || '') +
    ' · ' + ((state.user||{}).admin ? 'Quản trị' : 'Cấp '+(state.user||{}).level);
  loadDraft();
  if(!state.master || fresh){ if(!(await syncMaster(true)) && !state.master){ toast('Không tải được dữ liệu nền','bad'); } }
  if(!state.draft.machine){ const last = ls.get(K.lastMachine); if(last && machineByCode(last)){ state.draft.machine = last; state.draft.machineName = machineByCode(last).name; } }
  if(!state.draft.unit && units().length===1) state.draft.unit = units()[0].name;
  renderEntry(); updateSyncChip(); showView('entry');
  flushOutbox(true);
  syncMaster(true);
}

/* ---- cấu hình API lần đầu ---- */
$('#setup-save').addEventListener('click', async ()=>{
  const url = $('#setup-url').value.trim();
  $('#setup-msg').className='msg'; $('#setup-msg').textContent='';
  if(!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(url))
    { $('#setup-msg').textContent='Đường dẫn phải có dạng https://script.google.com/macros/s/.../exec'; return; }
  busy(true);
  const prev = state.apiUrl; state.apiUrl = url;
  try{
    const r = await api('ping');
    ls.set(K.cfg, url);
    $('#setup-msg').className='msg ok'; $('#setup-msg').textContent='Kết nối thành công: '+(r.title||'Google Sheet');
    setTimeout(()=> showScreen(state.token?'app':'login'), 700);
    if(state.token) enterApp(true);
  }catch(e){ state.apiUrl = prev; $('#setup-msg').textContent = e.message; }
  finally{ busy(false); }
});

/* ---------------------------------------------------------------- khởi động */
(function init(){
  state.apiUrl = ls.get(K.cfg, '') || (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  state.token  = ls.get(K.token, '') || '';
  state.user   = ls.get(K.user, null);
  state.master = ls.get(K.master, null);
  $('#today-date').value = todayStr();
  setRange('7');
  renderMasterTabs();

  if(!state.apiUrl) showScreen('setup');
  else if(!state.token || !state.user) showScreen('login');
  else enterApp(false);

  if('serviceWorker' in navigator)
    window.addEventListener('load', ()=> navigator.serviceWorker.register('sw.js').catch(()=>{}));
})();

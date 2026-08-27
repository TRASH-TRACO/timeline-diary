// ══════════════════════════════════════════
// 일기장 UI — 캘린더 · 하루 패널 · 타임라인 가져오기
// ══════════════════════════════════════════

const WD = ['일', '월', '화', '수', '목', '금', '토'];
let calYear, calMonth, selDate;

// ── 화면 상태 기억 (이 기기 로컬) ───────────
const VIEW_KEY = 'diary_view';
function saveView(){
  try{ localStorage.setItem(VIEW_KEY, JSON.stringify({ y: calYear, m: calMonth, d: selDate })); }catch(_){}
}
function loadView(){
  const t = new Date();
  calYear = t.getFullYear(); calMonth = t.getMonth(); selDate = todayStr();
  try{
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if(v && typeof v === 'object'){
      if(typeof v.y === 'number') calYear = v.y;
      if(typeof v.m === 'number' && v.m >= 0 && v.m <= 11) calMonth = v.m;
      if(typeof v.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.d)) selDate = v.d;
    }
  }catch(_){}
}

// ── 진입 게이트 ─────────────────────────────
const ENTRY_KEY = 'diaryEntryMode';
function applyEntryGate(){
  const g = $('gate');
  if(!g) return;
  let mode = null;
  try{ mode = localStorage.getItem(ENTRY_KEY); }catch(_){}
  g.style.display = mode ? 'none' : 'flex';
}
function chooseEntry(mode){
  try{ localStorage.setItem(ENTRY_KEY, mode); }catch(_){}
  const g = $('gate');
  if(g) g.style.display = 'none';
  if(mode === 'cloud' && typeof window.onSyncChipClick === 'function') window.onSyncChipClick();
}
window.chooseEntry = chooseEntry;

/**
 * 로컬 전용 안내 — 로그인하지 않았는데 기록이 쌓여 있을 때만 띄운다.
 * (기록이 하나도 없을 땐 알릴 게 없으니 조용히 둔다)
 */
function refreshLocalNote(){
  const el = $('local-note');
  if(!el) return;
  const signedIn = !!(window.DiarySync && window.DiarySync.isSignedIn && window.DiarySync.isSignedIn());
  const s = DiaryStore.stats();
  el.hidden = signedIn || (s.routes === 0 && s.notes === 0);
}
// 로그인 상태가 바뀌면 동기화 모듈이 불러준다
window.onAuthChange = () => { refreshLocalNote(); };

// ── 캘린더 ──────────────────────────────────
function shiftMonth(delta){
  calMonth += delta;
  if(calMonth < 0){ calMonth = 11; calYear--; }
  else if(calMonth > 11){ calMonth = 0; calYear++; }
  renderCalendar(); saveView();
}
function goToday(){
  const t = new Date();
  calYear = t.getFullYear(); calMonth = t.getMonth(); selDate = todayStr();
  renderCalendar(); renderPanel(); saveView();
}
window.shiftMonth = shiftMonth;
window.goToday = goToday;

function renderCalendar(){
  $('cal-title').textContent = calYear + '년 ' + (calMonth + 1) + '월';
  const grid = $('cal-grid');
  grid.innerHTML = '';
  WD.forEach((w, i) => {
    const c = document.createElement('div');
    c.className = 'cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    c.textContent = w;
    grid.appendChild(c);
  });

  const startDow = new Date(calYear, calMonth, 1).getDay();
  const days = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayStr();
  for(let i = 0; i < startDow; i++){
    const c = document.createElement('div');
    c.className = 'cal-cell empty';
    grid.appendChild(c);
  }
  for(let d = 1; d <= days; d++){
    const ds = `${calYear}-${pad2(calMonth + 1)}-${pad2(d)}`;
    const rec = DiaryStore.getDay(ds);
    const dow = (startDow + d - 1) % 7;
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.dataset.ds = ds;
    if(ds === today)   cell.classList.add('today');
    if(ds === selDate) cell.classList.add('sel');
    if(rec && rec.route) cell.classList.add('has-route');

    const head = document.createElement('div');
    head.className = 'cal-head';
    const num = document.createElement('span');
    num.className = 'cal-dnum' + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    num.textContent = d;
    head.appendChild(num);
    if(rec && rec.note){
      const mk = document.createElement('span');
      mk.className = 'cal-note-mark';
      mk.textContent = '✎';
      mk.title = rec.note;
      head.appendChild(mk);
    }
    cell.appendChild(head);

    if(rec && rec.route){
      const box = document.createElement('div');
      box.className = 'cal-thumb';
      box.innerHTML = DiaryViz.thumbSVG(rec.route, 46);
      cell.appendChild(box);
      const dist = document.createElement('div');
      dist.className = 'cal-dist';
      dist.textContent = fmtDist(rec.route.d || 0);
      cell.appendChild(dist);
    }
    cell.onclick = () => { selDate = ds; renderCalendar(); renderPanel(); saveView(); };
    cell.tabIndex = 0;
    cell.onkeydown = e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); cell.onclick(); } };
    grid.appendChild(cell);
  }
  renderMonthSummary();
}

/** 이 달 요약 — 캘린더 위에 얹는 한 줄 */
function renderMonthSummary(){
  const el = $('cal-sum');
  if(!el) return;
  const key = `${calYear}-${pad2(calMonth + 1)}`;
  const m = DiaryStore.getMonth(key, false);
  let routes = 0, notes = 0, dist = 0;
  if(m) for(const ds in m.days){
    const d = m.days[ds];
    if(d.route){ routes++; dist += d.route.d || 0; }
    if(d.note) notes++;
  }
  el.innerHTML = routes || notes
    ? `<span>경로 <b>${routes}</b>일</span><span>일기 <b>${notes}</b>편</span><span>이동 <b>${fmtDist(dist)}</b></span>`
    : '<span class="dim">이 달은 아직 비어 있어요</span>';
  refreshLocalNote();
}

// ── 하루 패널 ───────────────────────────────
let _noteTimer = null;

function renderPanel(){
  const panel = $('panel');
  const rec = DiaryStore.getDay(selDate) || {};
  const d = new Date(selDate + 'T00:00:00');
  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  const isToday = selDate === todayStr();

  let html = `<div class="pn-hdr"><div class="pn-date">${label}${isToday ? '<span class="pn-today">오늘</span>' : ''}</div>`;
  if(rec.route) html += `<button class="pn-del" onclick="removeRoute()" title="이 날 경로 지우기">경로 삭제</button>`;
  html += `</div>`;

  html += `<div class="pn-route" id="pn-route"></div>`;

  html += `<div class="pn-note">` +
    `<label class="pn-note-lbl" for="note-input">오늘의 일기</label>` +
    `<textarea id="note-input" class="pn-note-input" rows="4" maxlength="${DiaryStore.NOTE_MAX}" ` +
      `placeholder="이 날 어땠나요? 짧게 남겨두면 나중에 경로와 함께 보입니다."></textarea>` +
    `<div class="pn-note-foot"><span id="note-count">0/${DiaryStore.NOTE_MAX}</span><span id="note-saved" class="pn-saved"></span></div>` +
  `</div>`;

  panel.innerHTML = html;

  // 경로
  const routeEl = $('pn-route');
  if(rec.route){
    DiaryViz.renderRoute(routeEl, rec.route, selDate);
    renderVisitList(routeEl, rec.route);
  }else{
    routeEl.innerHTML =
      `<div class="pn-empty">` +
        `<div class="pn-empty-ico">🗺️</div>` +
        `<div class="pn-empty-t">이 날의 경로가 아직 없어요</div>` +
        `<p class="pn-empty-d">구글 타임라인 데이터를 올리면 그날 다닌 길이 여기 그려집니다.</p>` +
        `<button class="btn pri" onclick="openImport()">타임라인 가져오기</button>` +
      `</div>`;
  }

  // 일기
  const ta = $('note-input');
  ta.value = rec.note || '';
  $('note-count').textContent = ta.value.length + '/' + DiaryStore.NOTE_MAX;
  ta.addEventListener('input', () => {
    $('note-count').textContent = ta.value.length + '/' + DiaryStore.NOTE_MAX;
    $('note-saved').textContent = '';
    clearTimeout(_noteTimer);
    _noteTimer = setTimeout(async () => {
      const ds = selDate;
      await DiaryStore.setNote(ds, ta.value);
      if(ds === selDate) $('note-saved').textContent = '저장됨';
      updateCellNoteMark(ds);
      renderMonthSummary();
    }, 500);
  });
  ta.addEventListener('blur', () => {
    clearTimeout(_noteTimer);
    DiaryStore.setNote(selDate, ta.value).then(() => { updateCellNoteMark(selDate); renderMonthSummary(); });
  });
}

function renderVisitList(el, enc){
  const r = DiaryTimeline.decodeRoute(enc);
  if(!r || !r.visits || !r.visits.length) return;
  const box = document.createElement('div');
  box.className = 'pn-visits';
  box.innerHTML = '<div class="pn-visits-t">머문 곳</div><div class="pn-visits-l">' +
    r.visits.map(v => `<span class="visit-chip"><b>${escapeHtml(hmAt(v.s, r.tz))}</b>` +
      (v.n ? ' ' + escapeHtml(v.n) : '') +
      `<span class="visit-dur">${fmtDur(v.e - v.s)}</span></span>`).join('') +
    '</div>';
  el.appendChild(box);
}

/** 일기 표식(✎)만 즉석 갱신 — 입력 중 전체 재렌더로 포커스를 잃지 않게 */
function updateCellNoteMark(ds){
  const cell = document.querySelector('.cal-cell[data-ds="' + ds + '"]');
  if(!cell) return;
  const rec = DiaryStore.getDay(ds);
  const has = !!(rec && rec.note);
  let mk = cell.querySelector('.cal-note-mark');
  if(has && !mk){
    mk = document.createElement('span');
    mk.className = 'cal-note-mark';
    mk.textContent = '✎';
    cell.querySelector('.cal-head').appendChild(mk);
  }else if(!has && mk) mk.remove();
  if(mk) mk.title = (rec && rec.note) || '';
}

async function removeRoute(){
  if(!confirm('이 날의 경로를 지울까요?\n(일기는 그대로 남습니다)')) return;
  await DiaryStore.deleteRoute(selDate);
  renderCalendar(); renderPanel();
  showToast('🗑 경로를 지웠어요');
}
window.removeRoute = removeRoute;

// ══════════════════════════════════════════
// 타임라인 가져오기
// ══════════════════════════════════════════
function openImport(){ $('import-modal').style.display = 'flex'; setImportStatus('', ''); }
function closeImport(){ $('import-modal').style.display = 'none'; }
window.openImport = openImport;
window.closeImport = closeImport;

function setImportStatus(msg, cls){
  const el = $('imp-status');
  if(!el) return;
  el.className = 'imp-status' + (cls ? ' ' + cls : '');
  el.innerHTML = msg;
}
const nextFrame = () => new Promise(r => setTimeout(r, 0));

// Takeout ZIP 안에서 위치 기록으로 보이는 파일만 고른다
const LOC_HINT = /(location|timeline|semantic|records|위치|타임라인|기록)/i;
const MAX_JSON_BYTES = 260 * 1024 * 1024;

async function handleFiles(files){
  files = Array.from(files || []);
  if(!files.length) return;
  const acc = DiaryTimeline.newAcc();
  const skipped = [];
  let read = 0;

  for(const f of files){
    try{
      if(/\.zip$/i.test(f.name)){
        setImportStatus(`📦 ${escapeHtml(f.name)} 열어보는 중…`, 'busy');
        await nextFrame();
        if(!DiaryZip.zipSupported()){
          skipped.push(f.name + ' (이 브라우저는 ZIP을 못 풀어요 — 압축을 푼 뒤 .json을 올려주세요)');
          continue;
        }
        const all = await DiaryZip.zipEntries(f);
        let cands = all.filter(e => /\.json$/i.test(e.name) && LOC_HINT.test(e.name));
        if(!cands.length) cands = all.filter(e => /\.json$/i.test(e.name));
        if(!cands.length){ skipped.push(f.name + ' (안에 JSON이 없어요)'); continue; }
        for(let i = 0; i < cands.length; i++){
          const e = cands[i];
          if(e.uSize > MAX_JSON_BYTES){ skipped.push(e.name + ' (너무 커요)'); continue; }
          setImportStatus(`📦 ${escapeHtml(f.name)} — ${i + 1}/${cands.length} 읽는 중…`, 'busy');
          await nextFrame();
          try{
            const txt = await DiaryZip.zipReadText(f, e);
            DiaryTimeline.ingest(JSON.parse(txt), acc);
            read++;
          }catch(err){ skipped.push(e.name + ' (' + err.message + ')'); }
        }
      }else if(/\.json$/i.test(f.name) || f.type === 'application/json'){
        if(f.size > MAX_JSON_BYTES){
          skipped.push(f.name + ' (너무 커요 — Records.json 대신 Timeline.json이나 월별 파일을 올려주세요)');
          continue;
        }
        setImportStatus(`📄 ${escapeHtml(f.name)} 읽는 중…`, 'busy');
        await nextFrame();
        DiaryTimeline.ingest(JSON.parse(await f.text()), acc);
        read++;
      }else{
        skipped.push(f.name + ' (.json 또는 .zip만 받아요)');
      }
    }catch(err){
      console.warn('[import]', f.name, err);
      skipped.push(f.name + ' (' + (err.message || '읽기 실패') + ')');
    }
  }

  if(!read){
    setImportStatus('읽을 수 있는 파일이 없었어요.<br>' + skipped.map(escapeHtml).join('<br>'), 'err');
    return;
  }

  setImportStatus('🧭 경로 정리하는 중…', 'busy');
  await nextFrame();
  const days = DiaryTimeline.accToDays(acc);
  const dsList = Object.keys(days).sort();
  if(!dsList.length){
    setImportStatus('파일은 읽었는데 위치 기록을 못 찾았어요.<br>구글 타임라인 반출 파일이 맞는지 확인해 주세요.', 'err');
    return;
  }

  await DiaryStore.setRoutes(days);
  const totalM = dsList.reduce((s, ds) => s + (days[ds].d || 0), 0);

  // 가져온 마지막 날로 화면을 옮겨 결과가 바로 보이게 한다
  const last = dsList[dsList.length - 1];
  selDate = last;
  calYear = +last.slice(0, 4); calMonth = +last.slice(5, 7) - 1;
  renderCalendar(); renderPanel(); saveView();

  // 어디에 저장됐는지를 결과에 같이 적는다 — 로그인 안 한 걸 모르고 넘어가면
  // "다른 기기에서 안 보인다"로 한참 뒤에야 알게 된다.
  const signedIn = !!(window.DiarySync && window.DiarySync.isSignedIn && window.DiarySync.isSignedIn());
  const where = signedIn
    ? '<br>☁️ 계정에 동기화됩니다.'
    : '<br>📱 <b>이 기기에만 저장됐어요.</b> 다른 기기에서도 보려면 로그인하세요 — ' +
      '지금까지 쌓인 기록도 그대로 계정으로 옮겨갑니다.';
  setImportStatus(
    `✅ <b>${fmtNum(dsList.length)}일</b>의 경로를 가져왔어요.<br>` +
    `${dsList[0]} ~ ${last} · 총 이동 ${fmtDist(totalM)}` + where +
    (skipped.length ? `<br><span class="dim">건너뜀: ${escapeHtml(skipped.slice(0, 3).join(', '))}${skipped.length > 3 ? ' 외 ' + (skipped.length - 3) + '개' : ''}</span>` : ''),
    'ok');
  showToast(`✅ ${fmtNum(dsList.length)}일 경로를 가져왔어요`);
}
window.handleFiles = handleFiles;

function wireImport(){
  const input = $('imp-file');
  const drop  = $('imp-drop');
  if(input) input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
  if(drop){
    drop.addEventListener('click', () => input && input.click());
    drop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); input && input.click(); } });
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if(e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });
  }
}

// ── 데이터 관리 ─────────────────────────────
function openManage(){
  const s = DiaryStore.stats();
  $('mg-body').innerHTML =
    `<div class="mg-stats">` +
      `<div><span>일기</span><b>${fmtNum(s.notes)}편</b></div>` +
      `<div><span>경로</span><b>${fmtNum(s.routes)}일</b></div>` +
      `<div><span>총 이동</span><b>${fmtDist(s.distM)}</b></div>` +
      `<div><span>기간</span><b>${s.first ? s.first + ' ~ ' + s.last : '—'}</b></div>` +
    `</div>` +
    `<button class="btn danger" onclick="wipeRoutes()">가져온 경로 전체 삭제</button>` +
    `<p class="mg-note">일기는 지워지지 않아요. 타임라인을 다시 올리면 경로도 다시 채워집니다.</p>`;
  $('manage-modal').style.display = 'flex';
}
function closeManage(){ $('manage-modal').style.display = 'none'; }
async function wipeRoutes(){
  if(!confirm('가져온 경로를 전부 지울까요?\n(일기는 남습니다)')) return;
  const n = await DiaryStore.clearRoutes();
  renderCalendar(); renderPanel(); closeManage();
  showToast(`🗑 경로 ${fmtNum(n)}일치를 지웠어요`);
}
window.openManage = openManage;
window.closeManage = closeManage;
window.wipeRoutes = wipeRoutes;

// ── 로그아웃 ────────────────────────────────
function openLogout(){ $('logout-modal').style.display = 'flex'; }
function closeLogout(){ $('logout-modal').style.display = 'none'; }
async function doLogout(keepLocal){
  closeLogout();
  try{ if(window.DiarySync) await window.DiarySync.signOut(); }catch(_){}
  if(!keepLocal){
    // 이 기기에 남은 사본까지 지운다 (공용 기기용)
    for(const key of DiaryStore.monthKeys()) await idbDel('m:' + key);
    await idbDel('months'); await idbDel('dirty');
    try{ localStorage.removeItem(ENTRY_KEY); }catch(_){}
    location.reload();
    return;
  }
  showToast('로그아웃했어요 — 이 기기 기록은 그대로예요');
}
window.openLogout = openLogout;
window.closeLogout = closeLogout;
window.doLogout = doLogout;

// ── 도움말 ──────────────────────────────────
function openHelp(){ $('help-modal').style.display = 'flex'; }
function closeHelp(){ $('help-modal').style.display = 'none'; }
window.openHelp = openHelp;
window.closeHelp = closeHelp;

// ── 부팅 ────────────────────────────────────
// 테마가 바뀌면 경로 색(램프)을 다시 골라야 하므로 다시 그린다
window.onThemeChange = () => { renderCalendar(); renderPanel(); };

async function init(){
  applyThemeIcon();
  loadView();
  await DiaryStore.loadLocal();

  const now = new Date();
  $('today-date').textContent = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}`;

  renderCalendar();
  renderPanel();
  wireImport();
  applyEntryGate();
  refreshLocalNote();

  // 동기화로 데이터가 들어오면 화면을 맞춘다 (입력 중인 일기는 건드리지 않는다)
  DiaryStore.onChange(what => {
    if(what === 'note') return;
    renderCalendar();
    const ta = $('note-input');
    if(!ta || document.activeElement !== ta) renderPanel();
  });

  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    ['import-modal', 'manage-modal', 'help-modal', 'logout-modal'].forEach(id => {
      const m = $(id);
      if(m && m.style.display === 'flex') m.style.display = 'none';
    });
  });

  document.documentElement.classList.remove('booting');
}

// 동기화 모듈이 최초 로드를 기다릴 수 있도록 promise를 노출
window.__diaryReady = init().finally(() => document.documentElement.classList.remove('booting'));

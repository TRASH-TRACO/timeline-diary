// ══════════════════════════════════════════
// 일기장 저장소 — 월 단위 문서 하나에 그 달의 일기와 경로를 담는다
// ══════════════════════════════════════════
//
//   month = { v:1, days:{ 'YYYY-MM-DD': { note, noteAt, route, routeAt } } }
//
// 로컬(IndexedDB)과 클라우드(Firestore users/{uid}/diary/{YYYY-MM})가 같은 모양이라
// 병합 함수 하나를 양쪽에 그대로 쓴다. 병합은 "날짜 × 필드"별로 최신 것이 이긴다 —
// 그래서 기기 A에서 쓴 일기와 기기 B에서 올린 경로가 서로를 지우지 않는다.

const MONTH_IDX = 'months';
const _months = new Map();          // 'YYYY-MM' → month
const _dirty  = new Set();          // 아직 클라우드에 못 올린 달
let   _listeners = [];

const monthKeys = () => Array.from(_months.keys()).sort();
function getMonth(key, create){
  let m = _months.get(key);
  if(!m && create){ m = { v: 1, days: {} }; _months.set(key, m); }
  return m;
}
function getDay(ds){
  const m = _months.get(monthOf(ds));
  return (m && m.days[ds]) || null;
}

// ── 로컬 저장 ───────────────────────────────
async function loadLocal(){
  const idx = (await idbGet(MONTH_IDX)) || [];
  for(const key of idx){
    const m = await idbGet('m:' + key);
    if(m && typeof m === 'object' && m.days) _months.set(key, m);
  }
  const d = (await idbGet('dirty')) || [];
  d.forEach(k => _dirty.add(k));
}
async function saveMonth(key){
  const m = _months.get(key);
  if(!m) return;
  await idbSet('m:' + key, m);
  await idbSet(MONTH_IDX, monthKeys());
}
const saveDirty = () => idbSet('dirty', Array.from(_dirty));

// ── 변경 알림 ───────────────────────────────
function onChange(fn){ _listeners.push(fn); }
function emit(what){ _listeners.forEach(fn => { try{ fn(what); }catch(e){ console.warn(e); } }); }

/** 달을 바뀐 것으로 표시하고 저장 + 업로드 예약 */
async function touch(key, opts){
  _dirty.add(key);
  await saveMonth(key);
  await saveDirty();
  if(!(opts && opts.silent)) emit('data');
  if(window.DiarySync && typeof window.DiarySync.schedulePush === 'function') window.DiarySync.schedulePush(key);
}

// ── 쓰기 ────────────────────────────────────
const NOTE_MAX = 1000;

async function setNote(ds, text){
  const key = monthOf(ds);
  const m = getMonth(key, true);
  const day = m.days[ds] || (m.days[ds] = {});
  const v = String(text || '').slice(0, NOTE_MAX);
  if((day.note || '') === v) return;
  if(v.trim()) day.note = v; else delete day.note;
  day.noteAt = Date.now();
  // 지웠더라도 날짜 항목 자체는 남긴다 — noteAt이 "언제 지웠는지"를 들고 있어야
  // 다른 기기의 옛 일기가 동기화로 되살아나지 않는다(삭제 표식).
  await touch(key, { silent: true });
  emit('note');
}

/**
 * 가져온 경로들을 한 번에 반영. 같은 날 기록이 이미 있으면 덮어쓴다 —
 * 새로 받은 반출본이 더 최신이라고 보는 게 맞다. 일기는 건드리지 않는다.
 * @param routes {ds → 인코딩된 경로}
 */
async function setRoutes(routes){
  const now = Date.now();
  const touched = new Set();
  for(const ds in routes){
    const key = monthOf(ds);
    const m = getMonth(key, true);
    const day = m.days[ds] || (m.days[ds] = {});
    day.route = routes[ds];
    day.routeAt = now;
    touched.add(key);
  }
  for(const key of touched){ _dirty.add(key); await saveMonth(key); }
  await saveDirty();
  emit('data');
  if(window.DiarySync && typeof window.DiarySync.schedulePush === 'function'){
    touched.forEach(k => window.DiarySync.schedulePush(k));
  }
  return touched.size;
}

async function deleteRoute(ds){
  const key = monthOf(ds);
  const m = _months.get(key);
  if(!m || !m.days[ds] || !m.days[ds].route) return;
  delete m.days[ds].route;
  m.days[ds].routeAt = Date.now();   // 삭제 표식 — 동기화로 되살아나지 않게
  await touch(key);
}

/** 가져온 경로를 전부 지운다(일기는 남긴다). */
async function clearRoutes(){
  const now = Date.now();
  const touched = [];
  let n = 0;
  for(const key of monthKeys()){
    const m = _months.get(key);
    let hit = false;
    for(const ds in m.days){
      if(m.days[ds].route){
        delete m.days[ds].route;
        m.days[ds].routeAt = now;   // 삭제 표식
        hit = true; n++;
      }
    }
    if(hit){ _dirty.add(key); touched.push(key); await saveMonth(key); }
  }
  await saveDirty();
  emit('data');
  if(window.DiarySync && typeof window.DiarySync.schedulePush === 'function'){
    touched.forEach(k => window.DiarySync.schedulePush(k));
  }
  return n;
}

// ── 병합 (클라우드 ↔ 로컬) ──────────────────
/**
 * 원격 달 문서를 로컬에 합친다. 날짜 × 필드별로 타임스탬프가 큰 쪽이 이긴다.
 * @returns {boolean} 로컬이 바뀌었으면 true
 */
function mergeMonth(key, remote){
  if(!remote || typeof remote !== 'object' || !remote.days) return false;
  const local = getMonth(key, true);
  let changed = false;
  for(const ds in remote.days){
    const r = remote.days[ds];
    if(!r || typeof r !== 'object') continue;
    const l = local.days[ds] || (local.days[ds] = {});
    if((r.noteAt || 0) > (l.noteAt || 0)){
      if(r.note) l.note = String(r.note).slice(0, NOTE_MAX); else delete l.note;
      l.noteAt = r.noteAt || 0;
      changed = true;
    }
    if((r.routeAt || 0) > (l.routeAt || 0)){
      if(r.route) l.route = r.route; else delete l.route;
      l.routeAt = r.routeAt || 0;
      changed = true;
    }
    // 양쪽 모두 아무것도 없던 날이면 굳이 빈 항목을 남기지 않는다
    if(!l.note && !l.route && !l.noteAt && !l.routeAt) delete local.days[ds];
  }
  return changed;
}

/** 업로드용 — 그 달의 현재 내용 */
function snapshot(key){
  const m = _months.get(key);
  return m ? { v: 1, days: JSON.parse(JSON.stringify(m.days)) } : null;
}

const dirtyKeys  = () => Array.from(_dirty);
const markClean  = async key => { _dirty.delete(key); await saveDirty(); };
const markDirty  = async key => { _dirty.add(key); await saveDirty(); };
async function applyRemote(key, remote){
  const changed = mergeMonth(key, remote);
  if(changed){ await saveMonth(key); emit('data'); }
  return changed;
}

// ── 통계 ────────────────────────────────────
function stats(){
  let notes = 0, routes = 0, first = null, last = null, distM = 0;
  for(const key of monthKeys()){
    const days = _months.get(key).days;
    for(const ds in days){
      const d = days[ds];
      if(d.note) notes++;
      if(d.route){
        routes++;
        distM += d.route.d || 0;
        if(!first || ds < first) first = ds;
        if(!last  || ds > last)  last = ds;
      }
    }
  }
  return { notes, routes, first, last, distM };
}

window.DiaryStore = {
  NOTE_MAX, loadLocal, onChange, emit,
  getMonth, getDay, monthKeys,
  setNote, setRoutes, deleteRoute, clearRoutes,
  snapshot, applyRemote, dirtyKeys, markClean, markDirty, stats
};

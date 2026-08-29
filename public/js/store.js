// ══════════════════════════════════════════
// 일기장 저장소 — 월 단위 문서 하나에 그 달의 일기와 경로를 담는다
// ══════════════════════════════════════════
//
//   month = { v:1, days:{ 'YYYY-MM-DD': {
//     note, noteAt,                       // 기본 일기 — 항상 있다
//     t: { 트랙id: { v: 값, at: 시각 } }   // 트랙별 기록 (경로·복약 등)
//   } } }
//
// 트랙마다 at을 따로 두는 이유는 병합 때문이다. 한 기기에서 약을 기록하고 다른
// 기기에서 경로를 올려도 서로를 덮어쓰지 않는다.
//
// 로컬(IndexedDB)과 클라우드(Firestore users/{uid}/diary/{YYYY-MM})가 같은 모양이라
// 병합 함수 하나를 양쪽에 그대로 쓴다. 병합은 "날짜 × 필드"별로 최신 것이 이긴다 —
// 그래서 기기 A에서 쓴 일기와 기기 B에서 올린 경로가 서로를 지우지 않는다.

const MONTH_IDX = 'months';
const _months = new Map();          // 'YYYY-MM' → month
const _dirty  = new Set();          // 아직 클라우드에 못 올린 달
let   _listeners = [];

// 설정 — 어떤 트랙을 쓰는지 같은 것. 달 문서와 나란히 users/{uid}/diary/settings 에 산다.
// 값마다 at을 두어 달 문서와 같은 규칙(최신 우선)으로 병합한다.
const SETTINGS_KEY = 'settings';
let _settings = { v: 1, k: {} };
let _settingsDirty = false;

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

// ── 예전 형식 이관 ──────────────────────────
/**
 * 경로 v1(점 배열) → v2(쉼표로 이은 문자열).
 *
 * Firestore는 배열 원소마다 색인 항목을 만들고(오름차순·내림차순 각 1개),
 * 문서당 색인 항목은 4만 개가 상한이다. 하루 300점이면 원소가 900개라
 * 한 달에 22일 넘게 돌아다닌 달은 상한을 넘겨 업로드가 통째로 거부됐다.
 * 문자열로 담으면 색인 항목이 1개다.
 *
 * @returns {boolean} 바뀌었으면 true
 */
function routeToV2(route){
  if(!route || !Array.isArray(route.p)) return false;
  route.p = route.p.join(',');
  route.v = 2;
  return true;
}

/** 이 기기에 남아 있는 v1 경로를 전부 v2로 옮기고, 다시 올리도록 표시한다. */
/**
 * 하루 기록을 트랙 구조로 옮긴다.
 *   { route, routeAt }  →  { t: { route: { v, at } } }
 * 경로만 특별 대접하던 구조에서 여러 종류의 기록을 담는 구조로.
 * @returns {boolean} 바뀌었으면 true
 */
function dayToTracks(day){
  if(!day || !('route' in day || 'routeAt' in day)) return false;
  const t = day.t || (day.t = {});
  if(day.route || day.routeAt){
    t.route = { v: day.route || null, at: day.routeAt || 0 };
    if(!day.route) t.route.v = null;      // 삭제 표식은 그대로 옮긴다
  }
  delete day.route; delete day.routeAt;
  return true;
}

async function migrateRoutes(){
  let n = 0, moved = 0;
  for(const key of monthKeys()){
    const m = _months.get(key);
    let hit = false;
    for(const ds in m.days){
      const day = m.days[ds];
      if(routeToV2(day.route)){ hit = true; n++; }              // v1 배열 → v2 문자열
      if(routeToV2(day.t && day.t.route && day.t.route.v)){ hit = true; n++; }
      if(dayToTracks(day)){ hit = true; moved++; }              // route → t.route
    }
    if(hit){ _dirty.add(key); await saveMonth(key); }
  }
  if(n || moved){
    await saveDirty();
    console.info(`[store] 경로 ${n}일치 형식 변환, ${moved}일치를 트랙 구조로 옮겼습니다`);
  }
  return n + moved;
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
  const st = await idbGet(SETTINGS_KEY);
  if(st && typeof st === 'object' && st.k) _settings = st;
  _settingsDirty = !!(await idbGet('settingsDirty'));
  await migrateRoutes();
}

// ── 설정 ────────────────────────────────────
function getSetting(k, dflt){
  const e = _settings.k[k];
  return e && e.v !== undefined ? e.v : dflt;
}
async function setSetting(k, v){
  const cur = _settings.k[k];
  if(cur && JSON.stringify(cur.v) === JSON.stringify(v)) return;
  _settings.k[k] = { v, at: Date.now() };
  _settingsDirty = true;
  await idbSet(SETTINGS_KEY, _settings);
  await idbSet('settingsDirty', true);
  emit('data');
  if(window.DiarySync && typeof window.DiarySync.scheduleSettingsPush === 'function'){
    window.DiarySync.scheduleSettingsPush();
  }
}
const settingsSnapshot = () => JSON.parse(JSON.stringify(_settings));
const settingsDirty = () => _settingsDirty;
async function markSettingsClean(){ _settingsDirty = false; await idbSet('settingsDirty', false); }
async function markSettingsDirty(){ _settingsDirty = true; await idbSet('settingsDirty', true); }
/** 원격 설정을 합친다 — 값마다 최신 우선 */
async function applyRemoteSettings(remote){
  if(!remote || !remote.k) return false;
  let changed = false;
  for(const k in remote.k){
    const r = remote.k[k], l = _settings.k[k];
    if(r && (r.at || 0) > ((l && l.at) || 0)){ _settings.k[k] = { v: r.v, at: r.at || 0 }; changed = true; }
  }
  if(changed){ await idbSet(SETTINGS_KEY, _settings); emit('data'); }
  return changed;
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

// ── 트랙 ────────────────────────────────────
/** 그날 그 트랙의 값 (없으면 null) */
function getTrack(ds, trackId){
  const day = getDay(ds);
  const e = day && day.t && day.t[trackId];
  return e && e.v != null ? e.v : null;
}
/** 그날 기록이 하나라도 있는 트랙 id들 */
function daysTracks(day){
  if(!day || !day.t) return [];
  return Object.keys(day.t).filter(k => day.t[k] && day.t[k].v != null);
}
/**
 * 트랙 값을 쓴다. null을 주면 지운다(삭제 표식은 남는다 — 동기화로 되살아나지 않게).
 */
async function setTrack(ds, trackId, value){
  const key = monthOf(ds);
  const m = getMonth(key, true);
  const day = m.days[ds] || (m.days[ds] = {});
  const t = day.t || (day.t = {});
  t[trackId] = { v: value == null ? null : value, at: Date.now() };
  await touch(key);
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
    const t = day.t || (day.t = {});
    t.route = { v: routes[ds], at: now };
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
  const day = m && m.days[ds];
  if(!day || !day.t || !day.t.route || day.t.route.v == null) return;
  day.t.route = { v: null, at: Date.now() };   // 삭제 표식 — 동기화로 되살아나지 않게
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
      const day = m.days[ds];
      if(day.t && day.t.route && day.t.route.v != null){
        day.t.route = { v: null, at: now };   // 삭제 표식
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
    // 트랙은 종류별로 따로 견준다 — 한쪽에서 약을 쓰고 다른 쪽에서 경로를 올려도
    // 서로를 덮어쓰지 않는다.
    const rt = r.t || (('route' in r || 'routeAt' in r) ? { route: { v: r.route || null, at: r.routeAt || 0 } } : null);
    if(rt){
      const lt = l.t || (l.t = {});
      for(const id in rt){
        const rv = rt[id];
        if(!rv || typeof rv !== 'object') continue;
        if((rv.at || 0) > ((lt[id] && lt[id].at) || 0)){
          lt[id] = { v: rv.v == null ? null : rv.v, at: rv.at || 0 };
          if(id === 'route') routeToV2(lt[id].v);   // 예전 형식이면 받는 즉시 옮긴다
          changed = true;
        }
      }
    }
    // 양쪽 모두 아무것도 없던 날이면 굳이 빈 항목을 남기지 않는다
    if(!l.note && !l.noteAt && !daysTracks(l).length && !(l.t && Object.keys(l.t).length)) delete local.days[ds];
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
  const trackDays = {};
  for(const key of monthKeys()){
    const days = _months.get(key).days;
    for(const ds in days){
      const d = days[ds];
      if(d.note) notes++;
      for(const id of daysTracks(d)) trackDays[id] = (trackDays[id] || 0) + 1;
      const rt = d.t && d.t.route && d.t.route.v;
      if(rt){
        routes++;
        distM += rt.d || 0;
        if(!first || ds < first) first = ds;
        if(!last  || ds > last)  last = ds;
      }
    }
  }
  return { notes, routes, first, last, distM, trackDays };
}

window.DiaryStore = {
  NOTE_MAX, loadLocal, onChange, emit, migrateRoutes,
  getTrack, setTrack, daysTracks,
  getSetting, setSetting, settingsSnapshot, settingsDirty,
  markSettingsClean, markSettingsDirty, applyRemoteSettings,
  getMonth, getDay, monthKeys,
  setNote, setRoutes, deleteRoute, clearRoutes,
  snapshot, applyRemote, dirtyKeys, markClean, markDirty, stats
};

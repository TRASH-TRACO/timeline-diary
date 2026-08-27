# 경로 일기 (timeline-diary)

구글 타임라인을 올리면 **하루하루 다닌 길이 캘린더에 그려지는 일기장**입니다.
날짜를 누르면 그날의 경로가 지도로 펼쳐지고, 그 아래에 짧은 일기를 남길 수 있습니다.

- 하루 경로를 **한눈에 보기**(SVG)와 **지도에서 재생**(애니메이션) 두 가지로
- 구글 로그인 → 기기 간 동기화
- 로그인 없이도 사용 (이 기기에만 저장). 나중에 로그인하면 쌓인 기록이 그대로 계정으로 합류합니다.
- 업로드한 파일은 **브라우저 밖으로 나가지 않습니다.** 날짜별로 정리한 경로만 저장됩니다.

빌드 도구는 Vite. 런타임 의존성은 지도용 Leaflet 하나뿐이고, **API 키가 필요 없습니다.**
배경지도는 OpenStreetMap을 씁니다.

---

## 1. Vercel 배포

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → `TRASH-TRACO/timeline-diary` 선택
2. 설정은 건드릴 필요 없습니다. Vercel이 자동으로 잡습니다.
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. **Deploy** → 끝. `https://timeline-diary.vercel.app` 같은 주소가 나옵니다.

이후 `main`에 push하면 자동으로 재배포됩니다.

> 이 단계까지만 하면 **로그인 없이 사용하기**는 바로 됩니다.
> 구글 로그인은 아래 2번을 해야 동작합니다.

## 2. Firebase 설정 (구글 로그인용)

이 앱 전용 Firebase 프로젝트 **`timeline-diary-99be8`** 를 씁니다.
설정값은 [`src/firebase-config.js`](./src/firebase-config.js)에 들어 있으니
두 가지만 해주세요.

### 2-1. 승인된 도메인 추가

Firebase 콘솔 → **Authentication → 설정 → 승인된 도메인 → 도메인 추가**

1번에서 받은 Vercel 주소를 넣습니다. 예: `timeline-diary.vercel.app`

> 여기에 없는 도메인에서 로그인하면 `auth/unauthorized-domain` 오류가 납니다.
> 앱이 그 오류를 만나면 해결 방법을 화면에 띄워주니, 안내대로 하시면 됩니다.

### 2-2. Firestore 규칙 게시

Firebase 콘솔 → **Firestore Database → 규칙** 탭에 이 저장소의
[`firestore.rules`](./firestore.rules) 내용을 붙여넣고 **게시**를 누릅니다.

로그인한 사람이 **자기 UID 아래 문서만** 읽고 쓸 수 있게 하는 규칙 하나가 전부입니다.
하위 컬렉션은 상위 문서의 규칙을 물려받지 않으므로 `users/{uid}/diary/{monthKey}`
경로를 직접 적어주어야 합니다.

이 두 가지가 끝나면 구글 로그인과 기기 간 동기화가 동작합니다.

---

## 3. 선택 — 다른 Firebase 프로젝트로 옮기기

프로젝트를 갈아타고 싶으면 Vercel 프로젝트의
**Settings → Environment Variables**에 아래를 넣고 재배포하세요.
코드를 고칠 필요는 없습니다.

| 변수 | 예시 |
|---|---|
| `VITE_FB_API_KEY` | `AIzaSy...` |
| `VITE_FB_AUTH_DOMAIN` | `my-diary.firebaseapp.com` |
| `VITE_FB_PROJECT_ID` | `my-diary` |
| `VITE_FB_STORAGE` | `my-diary.firebasestorage.app` |
| `VITE_FB_SENDER_ID` | `1234567890` |
| `VITE_FB_APP_ID` | `1:1234567890:web:abcdef` |

값은 Firebase 콘솔 → 프로젝트 설정 → **내 앱 → 웹 앱**의 SDK 설정에 있습니다.
[`vercel.json`](./vercel.json)의 리라이트 주소도 같이 바꿔주세요(4번 참고).

> Firebase 웹 설정값은 비밀이 아닙니다. 브라우저에 그대로 실려 나가는 값이고,
> 실제 접근 통제는 보안 규칙과 승인된 도메인이 합니다. 그래서 기본값을
> [`src/firebase-config.js`](./src/firebase-config.js)에 그냥 적어 두었습니다.

## 4. 선택 — 로그인 팝업에 내 도메인 보이게 하기

기본 설정에서는 구글 로그인 팝업 주소창에 `timeline-diary-99be8.firebaseapp.com`이
잠깐 보입니다. 내 도메인으로 바꾸고 싶다면:

1. `VITE_FB_AUTH_DOMAIN`을 내 도메인으로 설정 (예: `timeline-diary.vercel.app`)
2. [`vercel.json`](./vercel.json)의 `/__/auth` 리라이트가 그 요청을 실제 Firebase
   인증 핸들러로 넘겨줍니다. 이미 `timeline-diary-99be8`를 가리키게 들어 있으니
   그대로 두면 됩니다. (3번으로 프로젝트를 옮겼다면 `destination`도 바꿔주세요)

이 리라이트는 기본 설정에서는 쓰이지 않으니, 신경 안 쓰셔도 아무 문제 없습니다.

---

## 지도 배경 바꾸기 (카카오맵 등)

기본 배경지도는 **OpenStreetMap**입니다. 키도 결제 계정도 필요 없어 설정 없이 바로
돌아갑니다. 다만 한국 골목·건물명 디테일은 카카오맵·네이버맵이 낫습니다.

바꿀 자리는 [`src/map.js`](./src/map.js) 맨 위 `TILE` 하나로 모아두었습니다.

```js
const TILE = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap 기여자',
  maxZoom: 19,
};
```

- **다른 타일 서버**(예: 지도 스타일만 교체)라면 이 값만 바꾸면 됩니다.
- **카카오맵·네이버맵**은 타일 서버를 직접 열어주지 않고 자체 SDK를 씁니다.
  Leaflet 대신 그 SDK로 갈아타야 하는데, 지도를 다루는 코드가 이 파일 하나에
  모여 있어 다른 파일은 손댈 필요가 없습니다. 키 발급과 도메인 등록이 따로 필요합니다.

> OSM 타일 서버는 [이용 정책](https://operations.osmfoundation.org/policies/tiles/)상
> 대규모 트래픽에는 쓸 수 없습니다. 개인용·소규모라면 문제없지만, 사용자가 늘면
> 유료 타일 제공자나 카카오맵으로 옮기는 게 맞습니다.

어두운 화면에서는 OSM이 밝은 지도만 제공하므로 CSS 필터로 반전시켜 씁니다
(`.leaflet-tile-pane`). 어두운 타일을 직접 제공하는 서버로 바꾼다면 그 규칙을 지우세요.

## 로컬에서 돌려보기

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 생성
npm run preview  # 빌드 결과 확인
```

`localhost`는 Firebase 승인된 도메인에 기본으로 들어 있어 로그인도 됩니다.

## 타임라인 데이터 받는 법

앱 안의 **도움말** 버튼에도 같은 내용이 있습니다.

- **안드로이드** — 설정 → 위치 → 위치 서비스 → 타임라인 → *타임라인 데이터 내보내기* → `Timeline.json`
- **아이폰** — Google 지도 → 프로필 → 타임라인 → ⋯ → 위치 및 개인 정보 설정 → *타임라인 데이터 내보내기* → `location-history.json`
- **Takeout** — [takeout.google.com](https://takeout.google.com/) → *위치 기록(타임라인)* 만 선택, JSON → 받은 `.zip`을 **압축 풀지 말고** 그대로 올리기

### 지원하는 형식

| 형식 | 파일 | 최상위 키 |
|---|---|---|
| 안드로이드 기기 반출 (2024~) | `Timeline.json` | `semanticSegments`, `rawSignals` |
| iOS 기기 반출 (2024~) | `location-history.json` | (배열) |
| 예전 Takeout 시맨틱 기록 | `2021_JANUARY.json` 등 | `timelineObjects` |
| 예전 Takeout 원시 기록 | `Records.json` | `locations` |

좌표 표기(`geo:37.5,127.0` / `37.5665°, 126.9780°` / `latitudeE7` / `latE7` / `{lat,lng}`)도
전부 받습니다. 날짜 분류는 기록에 박힌 UTC 오프셋을 우선 쓰고, 없으면 브라우저
시간대로 환산합니다 — 그래야 자정 근처 기록이 엉뚱한 날로 밀리지 않습니다.

아주 큰 `Records.json`(원시 위치 로그, 수백 MB)은 브라우저가 감당하기 어려워
건너뜁니다. 기기에서 내보낸 `Timeline.json`이나 `Semantic Location History` 폴더의
월별 파일을 쓰면 훨씬 빠르고 결과도 깔끔합니다.

---

## 구조

```
index.html              화면 뼈대
public/
  tokens.css            원시 디자인 토큰 (색·폰트·반경)
  diary.css             시맨틱 변수 + 컴포넌트 스타일 (다크모드 포함)
  js/
    util.js             IndexedDB · 날짜/시간대 · 거리 · 토스트
    timeline.js         구글 타임라인 파서 → 날짜별 경로
    zip.js              Takeout .zip 리더 (외부 라이브러리 없음, Zip64 지원)
    store.js            월 단위 저장소 + 병합
    viz.js              경로 비주얼라이저 (SVG · 하루를 한 장으로)
    app.js              캘린더 · 하루 패널 · 가져오기 UI
src/
  firebase-config.js    Firebase 설정 (환경 변수로 덮어쓰기 가능)
  sync.js               Firebase Auth + Firestore 동기화
  map.js                지도 재생기 (Leaflet · 배경지도를 바꾸려면 여기만)
firestore.rules         보안 규칙 (콘솔에 붙여넣을 것)
```

### 저장 구조

`users/{uid}/diary/{YYYY-MM}` — 한 달에 문서 하나에 그 달의 일기와 경로가 들어갑니다.
로컬(IndexedDB)과 원격이 같은 모양이라 병합 함수를 양쪽에 그대로 씁니다.

병합은 **날짜 × 필드별로 최신 우선**입니다. 그래서 A기기에서 쓴 일기와 B기기에서
올린 경로가 서로를 덮어쓰지 않고, 충돌을 물어볼 일도 없습니다.

경로는 좌표·시각을 정수 델타로 편 뒤 **쉼표로 이은 문자열 하나**에 담습니다.
배열이 아니라 문자열인 이유가 있습니다 — Firestore는 배열 원소마다 색인 항목을
만들고 문서당 4만 개가 상한인데, 하루 300점이면 원소가 900개라 활동이 많은 달은
문서 전체가 거부됩니다. 문자열이면 색인 항목이 1개입니다.
(덤으로 배열 안의 배열을 못 담는 제약도 사라지고 용량도 줍니다)

### 색에 대해

경로 색은 **시간**이라는 하나의 연속량을 나타내므로 단일 색상 램프
(이른 시각 → 늦은 시각) 하나만 씁니다. 무지개로 칠하면 순서가 안 읽힙니다.
시작·끝은 색이 아니라 글자로 구분하고, 라벨은 겹치면 자리를 옮기거나 아예
적지 않습니다. 밝은 화면과 어두운 화면의 램프는 자동 반전이 아니라 각각 따로
골랐습니다.

### 재생 속도에 대해

하루를 실제 시간대로 틀면 대부분이 정지 화면입니다(집·직장에 머무는 시간).
그렇다고 점 간격을 무시하고 일정 속도로 움직이면 "얼마나 오래 머물렀는지"가
사라집니다. 그래서 구간마다 실제 걸린 시간을 재생 시간으로 쓰되, 한자리에 오래
머문 구간은 전체의 4%까지만 시간을 주도록 눌렀습니다. 머문 티는 나되 화면이
멎지는 않습니다. 표시되는 시각은 눌리기 전의 진짜 시각입니다.

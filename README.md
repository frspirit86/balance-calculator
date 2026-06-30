# Football Balance Calculator — 정적 배포 버전

축구 게임 밸런스 튜닝 대시보드의 **정적(static) 포트폴리오 버전**.
백엔드(server.py) 없이, 클라이언트에서 번들된 JSON 데이터로 동작한다.

## 구조

```
web/
  index.html              # 랜딩(포트폴리오) 페이지
  graph_*.html            # 대시보드 8종 (정적 셰임 주입됨)
  assets/static-api.js    # /api/* 호출을 가로채는 클라이언트 백엔드 셰임
  data/*.json             # 번들된 밸런스 스냅샷 + CharacterStat
  vercel.json             # 배포 설정
```

## 동작 방식

- `static-api.js`가 `window.fetch`를 감싸 `/api/*` 요청을 가로챈다.
  - 읽기(load/characters/config)는 `data/*.json`에서 응답.
  - "적용"(`/api/save`)은 **localStorage 작업본**에 병합.
  - "현재 vs 기본값" 비교의 기준값(`/api/committed`)은 원본 스냅샷.
- 좌하단 바: **JSON 내보내기**(변경된 파일을 다운로드) / **기본값**(localStorage 초기화).
- Git Commit/Push 버튼은 정적 환경에서 숨김 처리.

> 변경값은 서버가 아니라 **이 브라우저에만** 저장된다. 다른 사람/기기에는 영향 없음.

## 로컬에서 미리보기

정적 파일이라 아무 정적 서버로나 열면 된다(파일을 직접 `file://`로 열면 `fetch`가 막히므로 서버 경유 필수):

```bash
cd web
python -m http.server 8080
# → http://localhost:8080
```

## Vercel 배포

1. 이 `web/` 폴더를 **별도 저장소**로 분리해 GitHub에 푸시한다.
   (상위 `confluence-pdf-export` 저장소에는 Atlassian 토큰 등 비공개 정보가 있으니 **함께 올리지 말 것**.)
2. Vercel에서 New Project → 해당 저장소 import.
3. Framework Preset: **Other** / Root Directory: 저장소 루트(또는 `web`).
   빌드 명령 없음, 출력 디렉터리 = 정적 루트.
4. Deploy. 끝.

데이터를 갱신하려면 `data/*.json`만 교체 후 재배포한다.

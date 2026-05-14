# About LG 번역 적용 툴 (html-tool) — 인수인계 요약

다른 에이전트가 이어서 작업할 수 있도록, 대화·구현·분석 내용을 한곳에 정리한 문서입니다.

---

## 1. 프로젝트가 하는 일

- **입력**: 지정 포맷의 `.xlsx` (첫 번째 시트만 사용)
- **처리**: SheetJS로 브라우저에서만 파싱 → `Business Area` **시트 이름이 아니라** `workbook.SheetNames[0]` 기준
- **템플릿**: `public/templates/business-area.cell-placeholder.mapped.html` 의 `{D6}` 등 셀 placeholder 치환
- **메타/UI**: `business-area-template.placeholder-map.config.json` (`excel-cell-placeholder`) + `placeholderMapToBusinessAreaCellMap.ts` 로 합성된 `sections[].fields` 로 우측 편집 패널 구성 (`value`→초기값, `multiline`, `inputType` 등)
- **출력**: 좌측 HTML 코드 / iframe 미리보기, `.html` 다운로드
- **금지**: 서버 업로드, API Route, DB, 로그인, Playwright 등 (원래 CONTEXT 명세와 동일)

---

## 2. 디렉터리·핵심 파일

| 경로 | 역할 |
|------|------|
| `app/page.tsx` | 메인 UI: 업로드, 탭(코드/미리보기), 전체화면, 다운로드, 우측 폼, 예제 엑셀 링크 |
| `app/layout.tsx`, `app/globals.css` | 레이아웃, Tailwind v4 |
| `features/html-generator/lib/parseExcel.ts` | 엑셀 → Workbook |
| `features/html-generator/lib/extractBusinessAreaCellData.ts` | **첫 시트** + 양식 검증 + 셀 추출 |
| `features/html-generator/lib/buildCellValueMapFromConfig.ts` | `initialValue` 기본 맵, 엑셀 빈값 시 `initialValue` 보완 |
| `features/html-generator/lib/generateHtmlByCellPlaceholders.ts` | placeholder 치환 + 셀별 multiline 이스케이프 |
| `features/html-generator/lib/rewriteLgDamPathsForPreview.ts` | **미리보기 전용** `/content/dam/` → `https://www.lg.com/content/dam/` |
| `features/html-generator/lib/loadBusinessAreaTemplateHtml.ts` | 공통 헤드 + mapped 본문 fetch (`loadBusinessAreaTemplateParts`) |
| `public/templates/business-area.common-head-fragment.html` | LG 패키지 CSS 링크 + 폰트 `@font-face` + 일부 스타일 (미리보기·조합용) |
| `public/templates/business-area.cell-placeholder.mapped.html` | placeholder 본문 (상단 공통 블록은 제거됨) |
| `public/example/business_area_template.xlsx` | 사용자 다운로드용 샘플 (없으면 링크 404 — `.gitkeep`만 있을 수 있음) |
| `public/fonts/*` | `@font-face` 가 가리키는 woff/woff2 (로컬 미러) |

워크스페이스 루트에는 `CONTEXT.md`, 루트용 `business-area.*` 복사본 등이 **별도**로 있을 수 있음. **앱 기준 경로는 항상 `html-tool/` 아래**로 본다.

---

## 3. 구현 시 합의·결정 사항 (대화 기준)

### 3.1 엑셀

- **읽는 시트**: 이름이 `"Business Area"`일 필요 없음 → **항상 첫 번째 시트**.
- **검증** (`validateFirstSheetBusinessAreaFormat`):
  - `!ref` 존재
  - JSON에 정의된 모든 매핑 셀이 `!ref` 범위 안
  - 탭명 행: `excel.tabColumns` + `excel.mainRows.tabName` (없으면 D4~G4) — `ignoreValues` 적용 후에도 비어 있으면 오류
- **오류 문구**: “Business Area 시트”가 아니라 **첫 번째 시트 이름 + 카피덱 그리드/형식** 기준으로 수정됨 (`extractBusinessAreaCellData.ts`).

### 3.2 `initialValue`

- 초기 `cellValueMap`은 `buildCellValueMapFromInitialValues(CONFIG)`.
- 업로드 후 `mergeExtractedWithInitialFallback`: 엑셀에서 온 값이 빈 문자열이면 해당 셀은 JSON `initialValue`로 채움.

### 3.3 HTML 조각 vs 공통 헤드

- **공통 헤드** (`business-area.common-head-fragment.html`): 외부 CSS, 로컬 폰트 등.
- **mapped 본문**: placeholder만 있는 본문.
- **로드**: `loadBusinessAreaTemplateParts()` 후 문자열 결합.
- **HTML 코드 / 다운로드**: **본문만** (`generatedBodyHtml`). 공통 헤드는 포함하지 않음.
- **미리보기 `srcDoc`**: 공통 헤드 + 본문 후, **`rewriteLgDamPathsForPreview`** 로 `/content/dam/` 만 `https://www.lg.com/content/dam/` 로 바꿔 에셋 표시 (코드/다운로드에는 적용 안 함).

### 3.4 전체화면

- **진입 버튼**: `HTML 코드` / `미리보기` 탭과 **같은 줄 오른쪽** (`미리보기` 탭일 때만 표시).
- **종료**: 전체화면 중에는 탭이 안 보이므로, `previewHostRef` 안 **상단 오버레이**에 “전체화면 종료” + ESC.
- `previewHostRef`는 iframe을 감싸는 래퍼 (전체화면 대상).

### 3.5 예제 엑셀 다운로드

- UI: 헤더 아래 점선 박스 + `/example/business_area_template.xlsx` 링크 (`download` 속성).
- 실제 파일은 `public/example/` 에 두어야 함.

### 3.6 외부 파일·비교 분석 (참고)

- `Untitled-1` vs `hq-common-2026-feature-about-lg-business-03-business-area.html` 비교 분석 요약:
  - Untitled는 **상단 LG 패키지 CSS + `.ST0002` 블록 없이** `<!-- 작업 영역 -->`부터 시작하는 조각에 가깝고, hq-common은 **헤드 포함** 전체 스니펫.
  - 구조 카운트(`business-area__container`, `accordion-item`)는 동일 수준.
  - diff 대부분은 속성 순서·자기닫힘 등 **포맷 차이**; 문구 대소문자·`We&#039;re` 등은 **카피/이스케이프** 차이로 검토 대상.

### 3.7 개발 환경

- Windows PowerShell에서 `npm` 스크립트 실행이 막힐 수 있음 → **`npm.cmd`** 사용 안내가 있었음.
- `Set-ExecutionPolicy`는 GPO로 막힐 수 있음.

---

## 4. 알려진 이슈·확장 포인트

- **`srcset`에 쉼표로 여러 URL**이 붙는 경우, `rewriteLgDamPathsForPreview`는 단순 `replaceAll` 위주라 일부만 바뀔 수 있음 → 필요 시 정규식 확장.
- **예제 xlsx**가 저장소에 없으면 다운로드 링크 404.
- **루트** `c:\workspace\` 의 `business-area.*`, `CONTEXT.md` 와 `html-tool/public/...` **이중 관리** 가능 → 한쪽만 소스 오브 트루스로 정리하면 좋음.

---

## 5. 실행

```powershell
Set-Location c:\workspace\html-tool
npm.cmd install   # 또는 npm
npm.cmd run dev
```

Vercel 배포 시 **Root Directory**: `html-tool`.

---

## 6. 원본 명세

- 상위 개념·금지 사항은 워크스페이스의 `CONTEXT.md` (또는 `context.md`) 참고.

---

*문서 생성일 기준: 대화에서 합의된 동작을 반영함. 이후 커밋에서 바뀐 부분은 코드·git 이력을 우선한다.*

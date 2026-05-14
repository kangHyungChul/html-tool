# context.md

## Project

Vercel 등 정적 호스팅에 올린 웹에서, 지정 포맷의 `.xlsx`를 **브라우저 안에서만** 읽어 셀 값을 HTML 템플릿의 `{D6}` 같은 placeholder에 매핑하고, 우측에서 수정한 뒤 HTML을 내려받는 클라이언트 전용 툴이다.

UI·메타데이터 상 제목은 **「Why LG 번역 적용 툴」**이며, `package.json`의 패키지 이름은 `business-area-html-tool`이다.

이 프로젝트는 외부 사이트를 조작하는 자동화(브라우저 드라이버 등)가 아니다.

```txt
JSON initialValue로 기본 CellValueMap 초기화
→ (선택) public/example 샘플 .xlsx 다운로드
→ 사용자 .xlsx 업로드: 첫 번째 시트 파싱 + 양식 검증
→ mapped 본문만 placeholder 치환 → 좌측 HTML 코드 / 다운로드
→ 미리보기만: 공통 헤드 + 본문, DAM 경로만 lg.com 절대 URL로 보정 후 iframe srcDoc
→ 우측 섹션 탭 ↔ 미리보기 탭 양방향 동기화(브리지 스크립트)
→ 전체화면(Fullscreen API)으로 미리보기 확대 가능
```

---

## Current Artifacts

저장소 기준 주요 파일:

```txt
public/templates/business-area.common-head-fragment.html   # 미리보기 전용 공통 헤드(CSS 링크·ST0002 등)
public/templates/business-area.cell-placeholder.mapped.html  # {D6} 등 placeholder 본문(치환·다운로드 대상)
public/example/business_area_template.xlsx              # 샘플 카피덱(없으면 다운로드 링크 404)
features/html-generator/constants/business-area-template.placeholder-map.config.json  # 매핑 단일 소스(excel-cell-placeholder)
context.md
```

핵심 TypeScript 모듈(`features/html-generator/lib/`):

```txt
parseExcel.ts
extractBusinessAreaCellData.ts
placeholderMapToBusinessAreaCellMap.ts
loadBusinessAreaTemplateHtml.ts
buildCellValueMapFromConfig.ts
buildMultilineByCellFromConfig.ts
generateHtmlByCellPlaceholders.ts
escapeHtml.ts
rewriteLgDamPathsForPreview.ts
businessAreaPreviewTabBridge.ts
downloadHtml.ts
getUsedPlaceholders.ts          # 유틸: 현재 page.tsx에서는 미사용
```

---

## Tech Stack

- Next.js 15 App Router (`app/page.tsx`가 `"use client"` 메인 화면)
- React 19
- TypeScript
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- SheetJS `xlsx` (엑셀 선택 시 동적 `import("xlsx")`로 `read` 로드)
- iframe `srcDoc`
- Browser Blob API
- (배포 타겟) Vercel 등 정적 호스팅 가정

---

## Do Not Use

- Playwright / Puppeteer / Selenium / Electron
- DB
- 로그인
- 서버로의 엑셀 업로드·HTML 저장
- 사용자 설정 영구 저장
- API Route를 둔 서버 측 변환(현재 코드 기준: 클라이언트만 사용)

---

## Core Rule

HTML 템플릿(본문 조각)에 엑셀 셀 주소 placeholder를 둔다.

```html
<h2 class="cmp-title__text">{D6}</h2>
<p>{D7}</p>
```

런타임은 업로드된 워크북의 **첫 번째 시트**에서, 설정 JSON에 나열된 셀만 읽어 `CellValueMap`을 만든 뒤, 본문 문자열의 placeholder를 치환한다. 시트 이름이 `Business Area`가 아니어도 첫 시트만 사용한다.

---

## Why Cell Placeholder Mapping

selector 기반 매핑 대신 셀 placeholder 방식을 사용한다.

장점:

- HTML만 봐도 어떤 엑셀 셀이 들어가는지 알 수 있다.
- CSS selector 매핑을 길게 관리하지 않아도 된다.
- HTML 구조가 조금 바뀌어도 placeholder만 유지하면 된다.
- 아코디언 id 순서와 엑셀 순서가 달라도 원하는 위치에 셀 주소를 직접 넣으면 된다.
- JSON은 HTML 위치 매핑이 아니라 우측 편집 UI·검증·라벨·`multiline`/`initialValue` 등 메타데이터로 사용한다.

---

## Excel Source (문서·JSON 메타 vs 런타임)

카피덱 원본 파일명 등은 JSON `excel.fileName` 등에 기록되어 있으나, **파일 선택기는 사용자 임의의 `.xlsx`**를 받는다.

런타임 동작:

- **항상 `workbook.SheetNames[0]`(첫 번째 시트)**만 읽는다. `sourceSheet` 필드는 타입·문서용이며, 시트명 매칭에는 쓰이지 않는다.
- `extractBusinessAreaCellData`는 다음을 검증한다.
  - `!ref` 존재 및 디코드 가능
  - JSON에 정의된 모든 매핑 셀이 해당 범위 안에 있는지
  - 탭명 행: `excel.tabColumns`의 각 열 + `excel.mainRows.tabName` 행 번호(없으면 기본 `D4`~`G4`) 칸이 **비어 있지 않은지**(빈 시트·다른 양식 배제)
- 셀 값은 `xlsx`의 `utils.format_cell` 우선으로 문자열화하고, `ignoreValues`(예: `N/A`)는 빈 문자열로 정규화한다.

문서화된 열·행 구조(카피덱과 맞추기 위한 참고, `placeholderMapToBusinessAreaCellMap.ts` 내 `excel` 메타·아코디언 행과 동일 계열):

```txt
D열 → Eco Solution
E열 → Vehicle Solution
F열 → Media Entertainment Solution
G열 → Home Appliance Solution
```

`mainRows`·`accordionRowGroups`는 JSON에 아코디언 행 범위 등으로 들어 있으며, **추출 로직은 `sections[].fields[].cell`에 명시된 주소만** 읽는다.

---

## HTML Template

파일:

```txt
public/templates/business-area.common-head-fragment.html   # 미리보기 스타일용(다운로드·코드 탭에 미포함)
public/templates/business-area.cell-placeholder.mapped.html   # placeholder 본문
```

`loadBusinessAreaTemplateParts()`가 위 둘을 `fetch`로 불러온다.

Placeholder 형식:

```txt
{D4}
{D6}
{E10}
{G35}
```

규칙:

- `{` + 대문자 컬럼 + 행 번호 + `}` 형식만 치환한다. 소문자 `{d6}` 등은 의도적으로 무시한다.
- placeholder 내부에 공백을 넣지 않는다.
- 동일 셀 placeholder는 여러 위치에서 반복 가능하다.
- 텍스트 노드와 `alt` 등 속성 값 모두 동일 정규식으로 치환 대상이 될 수 있다.

**코드 / 다운로드 vs 미리보기**

- **HTML 코드 탭·`HTML 다운로드`**: `mappedBody`만 치환한 문자열(`generatedBodyHtml`). 공통 헤드 조각은 넣지 않는다.
- **미리보기 iframe**: `commonHead` + 치환된 본문을 이은 뒤, `rewriteLgDamPathsForPreview`로 `/content/dam/` 참조만 `https://www.lg.com/content/dam/` 형태로 바꾼 `srcDoc`을 사용한다. (`/fonts/` 등 다른 루트 경로는 변경하지 않음)

---

## Mapping JSON

파일:

```txt
features/html-generator/constants/business-area-template.placeholder-map.config.json
```

형식은 `excel-cell-placeholder`(엑셀 스캔·`html-to-cell-placeholders` 스크립트와 동일). 앱 UI·엑셀 검증은 `placeholderMapToBusinessAreaCellMap.ts` 가 `sections`·`excel` 메타를 합성해 기존 코드와 호환한다.

앱에서 실제로 읽는 역할(요약):

- `ignoreValues`: `N/A` 등 → 빈 문자열 처리
- `excel.tabColumns`, `excel.mainRows.tabName`: 탭명 행 셀 주소 계산·양식 검증
- `sections[]`: 우측 편집 UI 섹션 탭(`key`, `label`)과 `fields[]`
- 각 `field`: `cell`, `label`, `inputType`(`text`|`textarea`), `required`, `multiline`, `initialValue`(선택)

JSON에 있으나 **현재 TypeScript가 읽지 않는** 예시 메타: `escapePolicy`, `html`, `excel.fileName`/`sheetName`/`accordionRowGroups` 전체 등(문서·에디터 참고용).

JSON은 CSS selector 매핑을 담당하지 않는다.

---

## Data Shape

```ts
export type CellAddress = string;
export type CellValueMap = Record<CellAddress, string>;
```

초기 상태는 `buildCellValueMapFromInitialValues(CONFIG)`로, 각 `field.initialValue`가 없으면 빈 문자열이다.

엑셀 업로드 후에는 `mergeExtractedWithInitialFallback(extracted, CONFIG)`로 병합한다.

- 추출 값이 **빈 문자열**이면 해당 셀은 JSON `initialValue` 기본값으로 되돌린다.
- 비어 있지 않으면 엑셀 값을 쓴다.

---

## 주요 함수 (실제 시그니처·동작)

### parseExcel

```ts
export async function parseExcel(file: File): Promise<XLSX.WorkBook>;
```

`file.arrayBuffer()` 후 `read(buffer, { type: "array", cellDates: true })`. 서버 전송 없음.

---

### extractBusinessAreaCellData

```ts
export function extractBusinessAreaCellData(workbook: XLSX.WorkBook): CellValueMap;
```

첫 번째 시트만 사용. 위 **양식 검증**을 통과하지 못하면 `Error`를 던진다. 설정에 나온 셀 주소만 읽고, `ignoreValues` 적용 후 문자열로 채운 맵을 반환한다.

---

### loadBusinessAreaTemplateParts

```ts
export async function loadBusinessAreaTemplateParts(): Promise<{
    commonHead: string;
    mappedBody: string;
}>;
```

공통 헤드와 mapped 본문을 각각 fetch한다.

---

### buildCellValueMapFromInitialValues / mergeExtractedWithInitialFallback

```ts
export function buildCellValueMapFromInitialValues(cfg: BusinessAreaCellMapConfig): CellValueMap;
export function mergeExtractedWithInitialFallback(
    extracted: CellValueMap,
    cfg: BusinessAreaCellMapConfig,
): CellValueMap;
```

우측 패널·엑셀 없을 때 기본값과, 업로드 후 빈 셀 시 JSON 보완 정책을 담당한다.

---

### buildMultilineByCellFromConfig

```ts
export function buildMultilineByCellFromConfig(
    cfg: BusinessAreaCellMapConfig,
): Record<string, boolean>;
```

`fields[].multiline === true`인 셀만 줄바꿈 `<br />` 처리 대상이 된다.

---

### generateHtmlByCellPlaceholders

```ts
export interface GenerateHtmlParams {
    template: string;
    data: CellValueMap;
    multilineByCell: Record<string, boolean>;
}

export function generateHtmlByCellPlaceholders(params: GenerateHtmlParams): string;
```

- `multilineByCell[cell] === true` → `escapeHtmlWithLineBreak`
- 그 외 → `escapeHtml`만(줄바꿈을 `<br />`로 바꾸지 않음)

---

### rewriteLgDamPathsForPreview

```ts
export function rewriteLgDamPathsForPreview(html: string, origin?: string): string;
```

미리보기 문자열만 DAM 루트 상대 경로를 `https://www.lg.com/content/dam/` 계열 절대 URL로 치환한다.

---

### businessAreaPreviewTabBridge

우측 `sections[].key`와 iframe 내 Business Area 탭(`PREVIEW_PANEL_ID_BY_SECTION_KEY`로 패널 id 매핑)을 맞춘다.

- 부모 → iframe: 해당 탭 DOM에 `.click()` 위임
- iframe → 부모: `MutationObserver`로 활성 탭 변화 감지 후 `activeSectionKey` 갱신

---

### downloadHtml

```ts
export function downloadHtml(params: { html: string; fileName: string }): void;
```

Blob + 임시 `<a download>`. 현재 페이지에서는 파일명 `business-area.generated.html`로 호출한다.

---

### getUsedPlaceholders

```ts
export function getUsedPlaceholders(template: string): string[];
```

템플릿에서 placeholder를 **등장 순서대로 중복 제거**해 반환한다. 디버그·검증용으로 존재하며, 메인 `page.tsx`에서는 아직 사용하지 않는다.

---

## Editor Panel Rule

- 상단 탭은 `sections[]` 단위(예: Eco / Vehicle / …). 탭 전환 시 **해당 섹션의 `fields`만** 표시한다.
- `field.cell`이 `{cell}` placeholder 및 `CellValueMap` 키와 연결된다.
- `field.inputType`이 `textarea`면 textarea, `text`면 한 줄 `input`.
- 값 변경 시 `cellValueMap[field.cell]` 갱신 → `generatedBodyHtml`·`previewSrcDoc`가 `useMemo`로 즉시 재계산된다.

---

## Layout

```txt
┌──────────────────────────────────────────────┬──────────────────────────────┐
│ Left Panel                                    │ Right Panel                  │
│ HTML 코드 / 미리보기 (+ 미리보기 전체화면)      │ 솔루션별 섹션 탭 + 필드 목록   │
├──────────────────────────────────────────────┼──────────────────────────────┤
│ [HTML 코드] [미리보기] [전체화면]             │ Eco / Vehicle / … 탭         │
│                                              │ 선택 섹션의 cell 필드들       │
│ 코드: 본문만 readOnly textarea                │ ...                          │
│ 미리보기: srcDoc (헤드+본문+DAM 보정)          │                              │
│ [HTML 다운로드]  상태 메시지                    │                              │
└──────────────────────────────────────────────┴──────────────────────────────┘
```

상단: 엑셀 업로드, 샘플 `business_area_template.xlsx` 다운로드 링크(`public/example`).

---

## Escape Policy

엑셀·입력 값은 HTML에 넣기 전 이스케이프한다.

```ts
export function escapeHtml(value: string): string;
export function escapeHtmlWithLineBreak(value: string): string;
```

`multiline` 필드만 `escapeHtmlWithLineBreak` 경로를 탄다. 인라인 raw HTML 삽입 모드는 구현하지 않는다.

---

## Implementation Rules

- Next.js App Router + TypeScript, 들여쓰기 4칸.
- 엑셀·HTML 생성·다운로드는 **클라이언트에서만** 수행한다.
- 엑셀 파일은 서버로 업로드하지 않는다.
- DB·로그인·설정 영구 저장·Playwright 계열은 사용하지 않는다.
- HTML 생성은 셀 placeholder 치환으로 구현한다.
- 우측 편집값은 즉시 코드·미리보기에 반영된다.
- 미리보기 iframe은 조각 HTML 동작을 위해 `sandbox`를 걸지 않는다(MVP 주석과 동일 정책).

---

## MVP Done Criteria

- 배포 웹에서 동작한다.
- `.xlsx` 업로드 가능(첫 시트·양식 검증 통과 시 값 반영).
- JSON 기본값으로도 우측 편집·placeholder 치환이 동작한다.
- 엑셀에서 읽은 값이 우측에 표시되고 수정 가능하다.
- 수정이 HTML 치환 결과에 반영된다.
- 좌측 HTML 코드(본문만)가 갱신된다.
- 좌측 iframe 미리보기가 갱신되고, DAM 자산이 미리보기에서 로드되도록 URL이 보정된다.
- `.html` 다운로드 가능(본문만, 공통 헤드 미포함).
- 엑셀·생성 HTML이 서버에 저장되지 않는다.
- (선택) `public/example/business_area_template.xlsx`가 있으면 샘플 다운로드가 200으로 동작한다.

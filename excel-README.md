# Excel HTML Placeholder Sync Scripts v2

## 구성

```txt
scripts/
├─ excel-to-placeholder-map.mjs
└─ html-to-cell-placeholders.mjs
package.json
```

## 설치

```bash
npm install
```

## 경로 설정

각 `.mjs` 파일 상단의 `CONFIG`에서 파일 경로를 직접 수정한다.

## 실행 순서

```bash
npm run map:excel
npm run map:html
```

## 결과

```txt
output/
├─ placeholderMap.config.json
├─ placeholderMap.mapped.config.json
├─ mapped.html
├─ mapping-report.md
├─ diff-report.md
└─ unresolved-report.md
```

## 리포트 설명

### mapping-report.md

전체 요약 리포트다.

- 입력/출력 파일
- 전체 치환 수
- 애매한 항목 수
- 매핑되지 않은 HTML 텍스트 수
- 사용되지 않은 엑셀 셀 수

### diff-report.md

매핑 전후 변경사항만 따로 정리한 리포트다.

- 어떤 HTML 텍스트가
- 어떤 셀 placeholder로
- 어떤 HTML context에서
- 어떻게 변경되었는지 확인할 수 있다.

### unresolved-report.md

자동 확정하지 못한 항목만 따로 정리한 리포트다.

- 중복값 때문에 애매한 항목
- 엑셀에서 찾지 못한 HTML 텍스트
- HTML에 사용되지 않은 엑셀 셀
- 사용자에게 확인해야 할 질문

## 기본 정책

- CSS/JS/class/id는 치환하지 않는다.
- 텍스트 노드, alt, aria-label만 후보로 본다.
- 같은 문구가 여러 엑셀 셀에 있으면 자동 치환하지 않는다.
- 애매한 항목은 unresolved-report.md에 기록한다.
- N/A, 빈값, -, — 는 기본 무시한다.

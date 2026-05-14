# 엑셀 ↔ HTML 셀 Placeholder 매핑 컨텍스트

## 목적

이 문서는 AI 에이전트가 다음 두 파일을 받아 작업할 때 사용하는 범용 컨텍스트 문서이다.

1. 원본 문구/콘텐츠가 들어 있는 엑셀 파일
2. 정적 콘텐츠가 들어 있는 HTML 파일

AI 에이전트는 엑셀 파일의 내용과 HTML 파일의 콘텐츠를 대조하여, HTML 안의 텍스트 영역을 `{A1}`, `{B12}`, `{AA35}` 같은 엑셀 셀 주소 placeholder로 치환해야 한다.

최종 목표는 이후 엑셀 업로드만으로 HTML의 각 placeholder가 해당 셀 값으로 자동 치환될 수 있는 HTML 템플릿을 만드는 것이다.

이 문서는 범용으로 사용해야 한다.  
사용자가 명시하지 않은 특정 파일명, 시트명, 열 번호, 행 번호, 페이지명, 섹션명, 컴포넌트명, 업무 카테고리를 임의로 가정하지 않는다.

---

## 핵심 작업

AI 에이전트는 아래 작업만 수행한다.

```txt
엑셀 콘텐츠와 HTML 콘텐츠 비교
→ HTML의 각 텍스트 영역이 엑셀의 어떤 셀과 대응되는지 찾기
→ HTML 텍스트를 {셀주소} placeholder로 치환
→ placeholder 메타데이터 JSON 생성
→ 애매하거나 매핑되지 않은 항목을 사용자에게 보고
```

이 문서는 웹앱 구현용 문서가 아니다.

다음 작업은 하지 않는다.

- 업로드 UI 구현
- 미리보기 UI 구현
- 다운로드 UI 구현
- Vercel 배포 구현
- DB 구현
- 로그인 구현
- 런타임 치환 로직 구현

단, 사용자가 별도로 요청한 경우에는 예외로 한다.

---

## 입력 파일

사용자는 다음 자료를 제공할 수 있다.

- 엑셀 파일 1개
- HTML 파일 1개
- 선택적인 매핑 힌트
- 선택적인 대상 시트명
- 선택적인 대상 콘텐츠 영역명
- 매핑해야 할 필드 또는 매핑하지 말아야 할 필드 목록
- 빈 값, 반복 값, 링크, 이미지, alt 텍스트, disclaimer 처리 규칙

AI 에이전트는 제공된 파일을 직접 검사하고 가능한 범위에서 매핑을 추론한다.

---

## 출력 파일

AI 에이전트는 다음 파일을 생성한다.

```txt
mapped.html
placeholderMap.config.json
mapping-report.md
```

### mapped.html

원본 HTML에서 매칭된 텍스트/콘텐츠 영역을 엑셀 셀 placeholder로 치환한 파일이다.

예시:

```html
<h2>원본 헤드라인 텍스트</h2>
```

위 코드는 다음처럼 바뀐다.

```html
<h2>{B6}</h2>
```

### placeholderMap.config.json

각 placeholder의 의미와 편집용 메타데이터를 담는 JSON 파일이다.

예시:

```json
{
    "version": "1.0",
    "mappingType": "excel-cell-placeholder",
    "source": {
        "excelFile": "user-provided",
        "htmlFile": "user-provided"
    },
    "sheets": [
        {
            "sheetName": "detected-or-user-confirmed-sheet",
            "sections": [
                {
                    "key": "section-01",
                    "label": "Section 01",
                    "fields": [
                        {
                            "cell": "B6",
                            "placeholder": "{B6}",
                            "label": "Headline",
                            "htmlContext": "h2 text",
                            "inputType": "textarea",
                            "required": true,
                            "multiline": false,
                            "status": "mapped"
                        }
                    ]
                }
            ]
        }
    ]
}
```

### mapping-report.md

사람이 확인할 수 있는 매핑 리포트이다.

포함 내용:

- 어떤 시트를 사용했는지
- 어떤 엑셀 셀이 매핑되었는지
- 어떤 HTML 영역이 치환되었는지
- 어떤 항목이 애매한지
- 어떤 HTML 텍스트가 매핑되지 않았는지
- 어떤 엑셀 셀이 관련 있어 보이지만 사용되지 않았는지
- 사용자에게 확인이 필요한 질문

---

## 매핑 원칙

우선순위는 직접적인 텍스트 대조이다.

AI 에이전트는 HTML의 표시 텍스트와 엑셀 셀 값을 비교한다.

비교 우선순위:

1. 완전 일치
2. 앞뒤 공백 제거 후 완전 일치
3. 줄바꿈과 반복 공백 정규화 후 일치
4. HTML entity 디코딩 후 일치
5. 긴 본문 블록의 부분 일치
6. 정확한 매칭이 불가능할 때만 의미/구조 기반 추론

HTML class명이나 selector에 과도하게 의존하지 않는다.

가장 중요한 기준은 다음 관계이다.

```txt
엑셀 셀 값 ↔ HTML 표시 콘텐츠
```

---

## Placeholder 규칙

엑셀 셀 주소 기반 placeholder를 사용한다.

형식:

```txt
{A1}
{B12}
{AA35}
```

규칙:

- 컬럼 문자는 대문자를 사용한다.
- 행 번호는 실제 엑셀 행 번호를 사용한다.
- 중괄호 안에 공백을 넣지 않는다.
- 셀 주소로 표현 가능한 경우 커스텀 placeholder명을 만들지 않는다.
- 동일한 엑셀 셀 값이 HTML 여러 위치에서 반복되면 동일한 placeholder를 여러 번 사용할 수 있다.
- CSS, JavaScript, 추적 코드, 구조용 속성은 명확히 엑셀 콘텐츠와 대응되지 않는 한 치환하지 않는다.

올바른 예:

```html
<h2>{B6}</h2>
<p>{B7}</p>
```

잘못된 예:

```html
<h2>{{headline}}</h2>
<p>{ headline }</p>
<p>{row-7-body}</p>
```

---

## 치환 대상

다음처럼 사용자에게 보이거나 콘텐츠 관리 대상인 텍스트 영역을 치환한다.

- 제목
- eyebrow / label
- 본문
- 설명문
- disclaimer
- CTA 버튼 텍스트
- 탭 라벨
- 아코디언 제목
- 카드 제목
- 제품명 / 서비스명
- 리스트 아이템 제목
- 이미지 `alt` 텍스트
- 엑셀 콘텐츠와 명확히 중복되는 ARIA label

예시:

```html
<a>Learn more</a>
```

엑셀 셀 `C12` 값이 `Learn more`라면 다음처럼 치환할 수 있다.

```html
<a>{C12}</a>
```

---

## 치환하지 말아야 할 대상

다음 항목은 치환하지 않는다.

- CSS
- JavaScript
- class명
- id
- 동작 제어용 data attribute
- 레이아웃 wrapper
- 엑셀에 없는 정적 시스템 문구
- tracking attribute
- analytics attribute
- asset URL
- 이미지 파일명
- 비디오 파일명
- form 동작 속성
- 엑셀 콘텐츠와 명확히 일치하지 않는 접근성 label
- 주석 텍스트

URL은 엑셀 파일에 해당 URL이 명확히 존재하고, 사용자가 URL 매핑을 기대하는 경우에만 치환한다.

---

## 링크와 CTA 매핑

CTA는 텍스트를 우선 매핑한다.

예시:

```html
<a href="/some/path"><span>Learn more</span></a>
```

엑셀에 `Learn more`만 있다면 visible text만 치환한다.

```html
<a href="/some/path"><span>{B12}</span></a>
```

`href`는 다음 조건을 모두 만족할 때만 치환한다.

- 엑셀 파일에 대상 URL이 존재한다.
- 해당 URL이 HTML 링크와 명확히 대응된다.
- 사용자가 링크도 매핑해야 한다고 확인했다.

애매하면 사용자에게 질문한다.

---

## 이미지 alt 매핑

이미지 alt 텍스트가 엑셀 값과 일치하면 alt 속성 값을 해당 셀 placeholder로 치환한다.

예시:

```html
<img src="/image.jpg" alt="Product Name">
```

위 코드는 다음처럼 바뀔 수 있다.

```html
<img src="/image.jpg" alt="{B18}">
```

alt 텍스트가 엑셀 콘텐츠와 직접 대응되는 경우에만 치환한다.

동일한 엑셀 값이 이미 visible CTA 텍스트로 사용되고 있고, 이미지 alt가 그 라벨을 중복하는 경우 같은 placeholder를 사용해도 된다.

alt 텍스트를 매핑해야 할지 애매하면 사용자에게 질문한다.

---

## 빈 값, N/A, placeholder 처리 정책

AI 에이전트는 하나의 고정된 빈 값 처리 정책을 임의로 가정하지 않는다.

사용자 지시가 없다면 기본값은 다음과 같이 둔다.

```json
{
    "ignoreValues": ["", "N/A", "NA", "-", "—"],
    "emptyValuePolicy": "ask-user-if-structural-impact"
}
```

규칙:

- 빈 값이나 무시 대상 값이 선택적 텍스트에 해당하면 JSON에서 제외하거나 optional로 표시할 수 있다.
- 빈 값 처리로 인해 HTML 블록 전체를 삭제하거나 숨겨야 할 수 있으면 사용자에게 질문한다.
- 사용자가 명시하지 않은 이상 HTML 블록을 자동 삭제하지 않는다.
- 복잡한 조건부 렌더링 규칙을 임의로 추론하지 않는다.

---

## JSON 메타데이터 규칙

JSON은 placeholder의 편집과 검증을 위한 메타데이터를 담는다.

fragile한 CSS selector에 의존하지 않는다.  
필요한 경우에만 보조 정보로 selector를 사용할 수 있다.

각 field에는 다음 정보를 포함한다.

```json
{
    "cell": "B6",
    "placeholder": "{B6}",
    "label": "Human-readable label",
    "htmlContext": "Short description of where this appears in HTML",
    "inputType": "text | textarea",
    "required": true,
    "multiline": false,
    "status": "mapped | ambiguous | skipped"
}
```

권장 루트 구조:

```json
{
    "version": "1.0",
    "mappingType": "excel-cell-placeholder",
    "placeholderPattern": "\\{([A-Z]+[0-9]+)\\}",
    "source": {
        "excelFile": "user-provided",
        "htmlFile": "user-provided"
    },
    "sheets": [],
    "fields": [],
    "ambiguousItems": [],
    "unmappedHtmlTexts": [],
    "unusedExcelCells": [],
    "questions": []
}
```

명확한 섹션 구조가 있으면 `sections`로 그룹화한다.  
섹션 구조가 불명확하면 `fields` 배열을 평면 구조로 둔다.

---

## 매칭 절차

### Step 1. 엑셀 검사

- workbook의 시트 목록을 확인한다.
- 어떤 시트가 원본 콘텐츠를 담고 있는지 판단한다.
- 의미 있는 텍스트가 들어 있는 셀을 탐색한다.
- 빈 셀과 구조용 라벨은 HTML에 나타나지 않는 한 제외한다.
- 실제 셀 주소를 보존한다.

여러 시트가 모두 관련 있어 보이면 사용자에게 어떤 시트를 사용할지 질문한다.

### Step 2. HTML 검사

- 표시되는 텍스트 노드를 추출한다.
- `alt`, `aria-label`, CTA 텍스트 같은 후보 속성값을 추출한다.
- CSS, JS, 주석, 구조 코드는 제외한다.
- 각 텍스트가 HTML 어디에 있는지 식별 가능한 context를 보존한다.

### Step 3. 콘텐츠 비교

- 엑셀 셀 값과 HTML 텍스트를 비교한다.
- 공백을 정규화해서 비교한다.
- HTML entity를 디코딩해서 비교한다.
- 원본 HTML의 포맷은 최대한 보존한다.
- fuzzy/semantic 매칭보다 정확한 매칭을 우선한다.

### Step 4. HTML 콘텐츠 치환

- 확정된 매칭 항목만 `{CELL}` placeholder로 치환한다.
- 관련 없는 HTML 구조는 수정하지 않는다.
- 필요한 경우가 아니면 HTML 파일 전체를 재정렬하거나 재포맷하지 않는다.
- indentation, class명, id, CSS, JS, asset path를 변경하지 않는다.

### Step 5. JSON 메타데이터 생성

- 매핑된 셀마다 JSON field를 추가한다.
- 동일 셀이 여러 HTML 위치에 사용되면 여러 context를 기록한다.
- 필수 여부는 명확한 경우에만 true로 둔다.
- 긴 본문은 `textarea`로 설정한다.
- 짧은 라벨, 버튼, 제목, 탭명은 `text`로 설정한다.

### Step 6. 검증

다음 항목을 검증한다.

- HTML 안의 모든 placeholder가 JSON에 존재하는지
- JSON의 모든 mapped placeholder가 HTML에 존재하는지
- 잘못된 placeholder 형식이 없는지
- CSS/JS 안에서 실수로 치환된 값이 없는지
- 반복 콘텐츠가 일관되게 매핑되었는지
- 애매한 항목을 임의로 추측하지 않고 보고했는지

---

## 사용자에게 질문해야 하는 경우

AI 에이전트는 다음 상황에서 반드시 사용자에게 질문한다.

### 파일 또는 시트가 애매한 경우

- 여러 시트가 관련 있어 보이는 경우
- 어떤 시트도 HTML 콘텐츠와 명확히 맞지 않는 경우
- 엑셀 안에 여러 콘텐츠 영역이 있고 대상 영역이 불분명한 경우
- 사용자가 대상 시트나 범위를 지정하지 않았고 자동 판단이 불확실한 경우

### 콘텐츠 매핑이 애매한 경우

- 동일한 텍스트가 여러 엑셀 셀에 있는 경우
- 하나의 HTML 텍스트가 여러 엑셀 셀과 대응될 수 있는 경우
- 엑셀 값과 HTML 텍스트가 비슷하지만 완전히 같지 않은 경우
- HTML 텍스트가 엑셀 값을 일부 수정한 형태로 보이는 경우
- 하나의 HTML 텍스트 블록이 여러 엑셀 셀을 조합한 것처럼 보이는 경우
- 하나의 엑셀 셀을 여러 HTML 노드로 분리해야 할 것처럼 보이는 경우

### 구조가 애매한 경우

- HTML 순서와 엑셀 순서가 다른 경우
- 탭, 아코디언, 카드, 섹션 순서가 서로 맞지 않는 경우
- 반복 컴포넌트가 많고 매핑 순서를 확정하기 어려운 경우
- 일부 HTML 섹션에 명확한 엑셀 대응값이 없는 경우

### 정책이 애매한 경우

- 이미지 alt 텍스트까지 매핑해야 하는지 불분명한 경우
- 링크나 URL까지 매핑해야 하는지 불분명한 경우
- `N/A`를 빈 문자열로 바꿀지, 블록을 숨길지, 그대로 둘지 불분명한 경우
- 빈 엑셀 값 때문에 HTML 블록을 제거해야 하는지 불분명한 경우
- 반복 텍스트를 같은 placeholder로 공유할지, 다른 셀을 사용할지 불분명한 경우

### 안전성 또는 데이터 무결성이 애매한 경우

- 매핑을 위해 구조용 HTML, script, CSS, 동작 속성을 변경해야 할 것 같은 경우
- HTML 블록 삭제나 재배치가 필요해 보이는 경우
- 엑셀에 없는 누락 콘텐츠를 추론해야 하는 경우
- 생성된 placeholder가 의도한 콘텐츠와 맞는지 확신할 수 없는 경우

애매한 항목이 일부 있더라도 전체 작업을 중단하지 않는다.  
확실한 매핑은 진행하고, 애매한 항목만 질문 목록으로 분리한다.

---

## 애매한 항목 보고 형식

`mapping-report.md`에는 다음 형식을 사용한다.

```md
## 사용자 확인 필요 항목

1. HTML 텍스트 "..."가 엑셀 B12와 C18 모두에 대응될 수 있습니다. 어떤 셀을 사용해야 하나요?
2. 엑셀 D20 값은 "N/A"인데 HTML에는 표시 카드가 있습니다. 이 카드를 유지, 빈값 처리, 삭제 중 어떻게 처리해야 하나요?
3. HTML 이미지 alt 텍스트 "..."와 정확히 일치하는 엑셀 값이 없습니다. alt 텍스트도 매핑해야 하나요?
```

JSON에는 다음 형식을 사용한다.

```json
{
    "ambiguousItems": [
        {
            "htmlText": "Example text",
            "candidateCells": ["B12", "C18"],
            "reason": "동일하거나 유사한 텍스트가 여러 셀에 존재함",
            "question": "이 HTML 텍스트에는 어떤 엑셀 셀을 사용해야 하나요?"
        }
    ]
}
```

---

## 결과물 품질 규칙

AI 에이전트는 다음을 지켜야 한다.

- 원본 HTML 구조를 보존한다.
- 확정된 콘텐츠 텍스트만 치환한다.
- 광범위하거나 파괴적인 재작성은 피한다.
- placeholder는 사람이 읽기 쉽고 실제 엑셀 셀 주소와 직접 연결되어야 한다.
- JSON은 이후 편집 UI를 만들 수 있을 정도로 충분한 메타데이터를 가져야 한다.
- 무엇이 매핑되었고 무엇이 확인 필요한지 리포트로 설명한다.
- 불확실한 부분은 명확히 밝힌다.
- 애매한 매핑을 조용히 추측해서 확정하지 않는다.

---

## 최종 검증 체크리스트

결과를 반환하기 전에 다음을 확인한다.

```txt
[ ] mapped.html 파일이 생성되었다.
[ ] placeholderMap.config.json 파일이 생성되었다.
[ ] mapping-report.md 파일이 생성되었다.
[ ] HTML placeholder가 {CELL_ADDRESS} 형식을 따른다.
[ ] HTML의 모든 placeholder가 JSON에 등록되어 있다.
[ ] JSON의 모든 mapped placeholder가 HTML에 존재한다.
[ ] CSS/JS/class/id가 실수로 치환되지 않았다.
[ ] 애매한 매핑 항목이 리포트에 정리되어 있다.
[ ] 사용자 확인 질문이 필요한 경우 명확히 작성되어 있다.
[ ] 원본 HTML 구조가 최대한 보존되었다.
```

---

## 최종 응답 형식

사용자에게 결과를 보고할 때는 다음 내용을 포함한다.

```txt
- 생성된 파일 목록
- 삽입된 placeholder 개수
- 생성된 JSON field 개수
- 애매한 항목 개수
- 매핑되지 않은 HTML 텍스트 개수
- 사용자 확인이 필요한 질문
```

애매한 항목이 남아 있다면 100% 정확하다고 말하지 않는다.

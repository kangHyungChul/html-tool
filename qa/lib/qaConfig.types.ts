import type { CellTextReadFrom } from "./cellTextRead";

/** locale 시트 찾기: exact → ca_en 이면 ca 접두어 재시도 */
export type LocaleSheetResolveMode = "exact-only" | "exact-then-prefix";

/** global 페이지에서 non-global 링크 처리 */
export type GlobalPageLinkMismatch = "warn" | "fail" | "skip";

/** Playwright page.goto waitUntil */
export type QaPageGotoWaitUntil = "domcontentloaded" | "load" | "networkidle";

export interface QaPageConfig {
    /** lg.com origin (끝 슬래시 없음) */
    lgComOrigin: string;
    /** locale 세gment 뒤에 붙는 About LG Business 경로 */
    aboutLgBusinessPath: string;
    /** UI·CLI 기본 baseline URL */
    defaultBaselineUrl: string;
    /** 번역·링크 검증 DOM 루트 */
    businessAreaRootSelector: string;
    /** 쿠키·동의 배너 닫기 시도 셀렉터 */
    cookieBannerSelectors: string[];
    /** Business Area 내 링크 추출 (`a[href]` 등) */
    linkExtractSelector: string;
}

export interface QaExcelParseConfig {
    /** SheetJS `read()` — Date 셀을 JS Date 로 파싱 */
    cellDates: boolean;
    /** true: `format_cell` 표시값, false: `cell.w` / `cell.v` 원시값 */
    useFormattedCellValue: boolean;
}

export interface QaExcelConfig {
    /** `qa/` 기준 placeholder-map JSON 상대 경로 (셀 주소·필드 목록) */
    placeholderMapPath: string;
    /** baseline 엑셀에서 읽을 시트명 */
    baselineSheetKey: string;
    localeSheetResolve: LocaleSheetResolveMode;
    /**
     * QA skip·빈값 처리 목록 (N/A 등).
     * placeholder-map JSON `options.ignoreValues` 와 동기화된 기본값 — config 가 우선.
     */
    ignoreValues: string[];
    /** false: 시트 양식 검증(`isBusinessAreaSheet`) 생략 — 비표준 카피덱 디버그용 */
    validateSheetLayout: boolean;
    /** 버퍼 로드·셀 읽기 방식 */
    parse: QaExcelParseConfig;
}

export interface QaTranslationConfig {
    /** D~G 열 → AEM tabpanel id (동일 텍스트 중복 시 패널로 좁힘) */
    columnToPanelId: Record<string, string>;
    /** baseline DOM 매칭 우선순위 */
    matchPriority: CellTextReadFrom[];
    /** 상대 CSS 셀렉터 생성 시 우선 class 접두어 */
    stableClassPrefixes: string[];
    /** id 셀렉터에서 제외할 패턴 (RegExp source) */
    unstableIdPattern: string;
    /**
     * DOM 경로 앵커로 쓸 id 패턴 (RegExp source, `i` 플래그).
     * 매칭 id 를 루트로 상대 셀렉터를 단축한다.
     */
    stableAnchorIdPatterns: string[];
}

/** tabpanel id 로 탭(role=tab) 클릭 — hidden tabpanel·lazy 콘텐츠 로드 */
export interface QaDomPrepareClickTabPanelsStep {
    type: "click-tab-panels";
    /** 비우면 `translation.columnToPanelId` 값 사용 */
    panelIds?: string[];
    /** `{panelId}` 치환 패턴 — 첫 매칭 locator 클릭 */
    tabLocatorPatterns?: string[];
}

/** 접힌 트리거(aria-expanded=false 등) 반복 클릭으로 전개 */
export interface QaDomPrepareExpandTriggersStep {
    type: "expand-triggers";
    /** scope 내 클릭 대상 Playwright selector */
    triggerSelector: string;
    /** true: 매칭 0개까지 반복 (아코디언 순차 전개) */
    repeatUntilNone: boolean;
    maxIterations?: number;
}

/** selector 매칭 요소를 순서대로 각 1회 클릭 */
export interface QaDomPrepareClickEachStep {
    type: "click-each";
    selector: string;
    /** 매칭 없을 때 무시 */
    optional?: boolean;
}

export type QaDomPrepareStep =
    | QaDomPrepareClickTabPanelsStep
    | QaDomPrepareExpandTriggersStep
    | QaDomPrepareClickEachStep;

/** DOM 매핑·번역 검증 전 scope 인터랙션 (탭·접기/펼치기·lazy-load) */
export interface QaDomPrepareConfig {
    enabled: boolean;
    steps: QaDomPrepareStep[];
    /** 모든 step 후 lazy-load 스크롤 */
    scrollAfterSteps: boolean;
}

export interface QaLinksConfig {
    enabled: {
        localePathRules: boolean;
        navigationCheck: boolean;
    };
    rules: {
        blankTargetMustUseGlobal: boolean;
        sameTabMustUseLocale: boolean;
        globalPageNonGlobalLinks: GlobalPageLinkMismatch;
        skipNonLgComLinks: boolean;
    };
    /** lg.com 링크 판별 RegExp source (`/pattern/i` 형태로 컴파일) */
    lgComHrefPattern: string;
}

export interface QaPhasesConfig {
    translation: boolean;
    linkLocaleRules: boolean;
    linkNavigation: boolean;
}

export interface QaTimeoutsConfig {
    pageGotoMs: number;
    pageGotoWaitUntil: QaPageGotoWaitUntil;
    postGotoHydrationMs: number;
    businessAreaRootMs: number;
    businessAreaScopeDefaultMs: number;
    primaryAttachedWaitCapMs: number;
    scopePollIntervalMs: number;
    scrollPauseMs: number;
    cookieBannerVisibleMs: number;
    cookieBannerClickMs: number;
    cookieBannerPostClickMs: number;
    linkPopupWaitMs: number;
    linkClickMs: number;
    linkPopupLoadMs: number;
    linkSameTabGotoMs: number;
    /** 탭·아코디언 클릭 후 DOM 반영 대기(ms) */
    prepareInteractionPauseMs: number;
    /** domPrepare 클릭 타임아웃(ms) */
    prepareClickTimeoutMs: number;
}

export interface QaBrowserConfig {
    headless: boolean;
    viewport: { width: number; height: number };
    locale: string;
    userAgent: string;
    args: string[];
    hideWebdriver: boolean;
    extraHTTPHeaders: Record<string, string>;
    httpErrorThreshold: number;
    accessDeniedTitlePattern: string;
}

/** Business Area QA 전체 설정 */
export interface QaConfig {
    page: QaPageConfig;
    excel: QaExcelConfig;
    translation: QaTranslationConfig;
    links: QaLinksConfig;
    phases: QaPhasesConfig;
    timeouts: QaTimeoutsConfig;
    browser: QaBrowserConfig;
    /** DOM 매핑 전 탭·아코디언 등 인터랙션 */
    domPrepare: QaDomPrepareConfig;
}

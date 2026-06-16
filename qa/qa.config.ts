/**
 * Business Area QA 사용자 설정
 *
 * - **활성 설정**: 아래 `qaConfig` 객체 (`...defaults` = 기본값 그대로 실행)
 * - **참조·수정**: 각 섹션 주석을 해제하고 값을 바꾼 뒤, 해당 `...defaults.xxx` spread 를 제거하거나 덮어쓰세요.
 * - **셀 주소·필드 목록(D6, D45…)** 은 `excel.placeholderMapPath` JSON
 * - **파싱 정책(ignoreValues, format_cell 등)** 은 `excel` 섹션 — 아래 주석 참고
 *
 * 2차 UI 연동 시 이 구조와 동일한 폼을 제공할 예정입니다.
 */
import { createDefaultQaConfig } from "./lib/qaConfig.defaults";
import type { QaConfig } from "./lib/qaConfig.types";

const defaults = createDefaultQaConfig();

/** 현재 적용되는 QA 설정 (기본값 + 사용자 override) */
export const qaConfig: QaConfig = {
    ...defaults,

    // =============================================================================
    // page — URL·페이지 경로·DOM 스코프
    // =============================================================================
    // page: {
    //     ...defaults.page,
    //
    //     /** lg.com origin (끝 슬래시 없음). `buildQaTargetPageUrl()` 조합에 사용 */
    //     lgComOrigin: "https://www.lg.com",
    //
    //     /** locale 세그먼트 뒤에 붙는 About LG Business 경로 (앞 `/` 포함) */
    //     aboutLgBusinessPath: "/business/about-lg-business/",
    //
    //     /** UI·CLI 기본 baseline(비교군) 페이지 URL */
    //     defaultBaselineUrl: "https://www.lg.com/global/business/about-lg-business/",
    //
    //     /** 번역·링크 검증 DOM 루트 셀렉터 (baseline/target 공통) */
    //     businessAreaRootSelector: ".business-area",
    //
    //     /** 쿠키·동의 배너가 QA를 가릴 때 순서대로 닫기 시도 (Playwright locator) */
    //     cookieBannerSelectors: [
    //         "#onetrust-accept-btn-handler",
    //         'button:has-text("Accept All")',
    //         'button:has-text("Accept all")',
    //         'button:has-text("Accept")',
    //         'button:has-text("Agree")',
    //         'button:has-text("I Agree")',
    //         ".cmp-button--accept-all",
    //     ],
    //
    //     /** Business Area 내부에서 추출할 링크 셀렉터 */
    //     linkExtractSelector: "a[href]",
    // },

    // =============================================================================
    // excel — 엑셀 파싱·시트 (셀 주소 목록은 placeholder-map JSON)
    // =============================================================================
    // excel: {
    //     ...defaults.excel,
    //
    //     /** `qa/` 패키지 기준 placeholder-map JSON (D6, D45, A4:G50 필드 정의) */
    //     placeholderMapPath: "assets/business-area-template.placeholder-map.config.json",
    //
    //     /** baseline(비교군) 엑셀에서 읽을 시트명 — 보통 global */
    //     baselineSheetKey: "global",
    //
    //     /**
    //      * locale 엑셀 시트 찾기 규칙
    //      * - `exact-then-prefix`: exact → 실패 시 ca_en → ca 접두어 재시도
    //      * - `exact-only`: exact 일치만
    //      */
    //     localeSheetResolve: "exact-then-prefix",
    //
    //     /** QA skip·빈값 처리 — 이 목록과 일치하면 번역 검증 skip (JSON 보다 config 우선) */
    //     ignoreValues: ["", "N/A", "NA", "-", "—"],
    //
    //     /** false: `isBusinessAreaSheet` 양식 검증 생략 (비표준 카피덱 디버그용) */
    //     validateSheetLayout: true,
    //
    //     parse: {
    //         /** SheetJS read — Date 셀을 JS Date 로 파싱 */
    //         cellDates: true,
    //         /** true: 엑셀 표시값(format_cell), false: cell.w / cell.v 원시값 */
    //         useFormattedCellValue: true,
    //     },
    // },

    // =============================================================================
    // translation — baseline DOM 매핑 알고리즘 (엑셀 업로드와 무관)
    // =============================================================================
    // translation: {
    //     ...defaults.translation,
    //
    //     /** D~G 열 → AEM tabpanel id. 동일 global 텍스트가 여러 패널에 있을 때 좁히기 */
    //     columnToPanelId: {
    //         D: "eco-solution",
    //         E: "vehicle-solution",
    //         F: "media-entertainment-solution",
    //         G: "home-appliance-solution",
    //     },
    //
    //     /**
    //      * baseline 페이지에서 global 텍스트 위치 탐색 순서
    //      * - `aria-label`: D45 tablist, D8 video 등 (자식 innerText 와 별개)
    //      * - `alt`: img alt
    //      * - `text`: 보이는 innerText (leaf 요소만)
    //      */
    //     matchPriority: ["aria-label", "alt", "text"],
    //
    //     /** `.business-area` 기준 상대 CSS 셀렉터 생성 시 우선 사용할 class 접두어 */
    //     stableClassPrefixes: ["cmp-", "c-text-", "accordion-", "business-area"],
    //
    //     /** id 셀렉터로 쓰지 않을 id 패턴 (RegExp source, swiper/uuid 등 불안정 id) */
    //     unstableIdPattern: "swiper|uuid|random",
    // },

    // =============================================================================
    // links — 링크 경로 규칙·클릭·404 검증
    // =============================================================================
    // links: {
    //     enabled: {
    //         /** global/locale 경로 규칙 검증 (link-locale 단계) */
    //         localePathRules: true,
    //         /** 링크 클릭·404 검증 (link-navigation 단계) */
    //         navigationCheck: true,
    //     },
    //     rules: {
    //         /** target=_blank 링크는 www.lg.com/global/ 경로 유지 필수 */
    //         blankTargetMustUseGlobal: true,
    //         /** 동일 탭 lg.com 링크는 locale 세그먼트(/uk/ 등) 사용 필수 */
    //         sameTabMustUseLocale: true,
    //         /**
    //          * global locale 페이지에서 non-global 링크 처리
    //          * - `warn`: 경고 (overallPass 에는 영향 없음)
    //          * - `fail`: 실패
    //          * - `skip`: skip
    //          */
    //         globalPageNonGlobalLinks: "warn",
    //         /** lg.com 이 아닌 href 는 경로 규칙 검증 skip */
    //         skipNonLgComLinks: true,
    //     },
    //     /** lg.com 내부 링크 판별 RegExp source (플래그 i 로 컴파일, 상대 `/` 경로는 별도 허용) */
    //     lgComHrefPattern: "^(https?:)?\\/\\/(www\\.)?lg\\.com\\/",
    // },

    // =============================================================================
    // phases — QA 단계 on/off (빠른 실행·부분 검증)
    // =============================================================================
    // phases: {
    //     /** baseline DOM 매핑 + locale 번역 비교 (off 시 baseline URL 로드 생략) */
    //     translation: true,
    //     /** 링크 global/locale 경로 규칙 (links.enabled.localePathRules 와 함께) */
    //     linkLocaleRules: true,
    //     /** 링크 클릭·404 (links.enabled.navigationCheck 와 함께) */
    //     linkNavigation: true,
    // },

    // =============================================================================
    // timeouts — 대기·타임아웃 (ms)
    // =============================================================================
    // timeouts: {
    //     ...defaults.timeouts,
    //
    //     /** page.goto 타임아웃 */
    //     pageGotoMs: 90_000,
    //
    //     /** page.goto waitUntil — lg.com 은 networkidle 비권장(수 분 소요 가능) */
    //     pageGotoWaitUntil: "domcontentloaded",
    //
    //     /** goto 직후 AEM hydration·lazy 컴포넌트 여유 대기 */
    //     postGotoHydrationMs: 2_000,
    //
    //     /** baseline/target `.business-area` 루트 attached 대기 */
    //     businessAreaRootMs: 45_000,
    //
    //     /** legacy `waitForBusinessAreaScope` 폴백 탐색 기본 타임아웃 */
    //     businessAreaScopeDefaultMs: 90_000,
    //
    //     /** scope 폴링 전 1차 attached 대기 상한 (businessAreaRootMs 와 min) */
    //     primaryAttachedWaitCapMs: 15_000,
    //
    //     /** Business Area 미발견 시 스크롤·배너 닫기 후 재시도 간격 */
    //     scopePollIntervalMs: 1_500,
    //
    //     /** lazy-load 유도 스크롤 step 간 pause */
    //     scrollPauseMs: 120,
    //
    //     /** 쿠키 배너 버튼 visible 대기 */
    //     cookieBannerVisibleMs: 800,
    //
    //     /** 쿠키 배너 click 타임아웃 */
    //     cookieBannerClickMs: 3_000,
    //
    //     /** 쿠키 배너 클릭 후 대기 */
    //     cookieBannerPostClickMs: 400,
    //
    //     /** target=_blank 클릭 후 popup page 이벤트 대기 */
    //     linkPopupWaitMs: 15_000,
    //
    //     /** 링크 click 타임아웃 */
    //     linkClickMs: 10_000,
    //
    //     /** popup domcontentloaded 대기 */
    //     linkPopupLoadMs: 20_000,
    //
    //     /** 동일 탭 링크 goto (별도 Page) 타임아웃 */
    //     linkSameTabGotoMs: 30_000,
    // },

    // =============================================================================
    // browser — Playwright Chromium (lg.com 403 대응)
    // =============================================================================
    // browser: {
    //     ...defaults.browser,
    //
    //     /** false 권장 — headless 시 lg.com Access Denied·403 가능 */
    //     headless: false,
    //
    //     /** 브라우저 viewport */
    //     viewport: { width: 1920, height: 1080 },
    //
    //     /** BrowserContext locale */
    //     locale: "en-US",
    //
    //     /** User-Agent (Akamai 봇 차단 우회용 Chrome UA) */
    //     userAgent:
    //         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    //
    //     /** Chromium launch args */
    //     args: [
    //         "--disable-blink-features=AutomationControlled",
    //         "--disable-dev-shm-usage",
    //         "--no-sandbox",
    //     ],
    //
    //     /** init script 로 navigator.webdriver 숨김 */
    //     hideWebdriver: true,
    //
    //     /** lg.com 이 기대하는 Chrome 클라이언트 힌트 헤더 */
    //     extraHTTPHeaders: {
    //         Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    //         "Accept-Language": "en-US,en;q=0.9",
    //         "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    //         "Sec-Ch-Ua-Mobile": "?0",
    //         "Sec-Ch-Ua-Platform": '"Windows"',
    //         "Upgrade-Insecure-Requests": "1",
    //     },
    //
    //     /** HTTP status >= 이 값이면 페이지 로드 실패 */
    //     httpErrorThreshold: 400,
    //
    //     /** 페이지 title 에 이 패턴( RegExp source, i )이 있으면 Access Denied 로 간주 */
    //     accessDeniedTitlePattern: "access denied",
    // },
};

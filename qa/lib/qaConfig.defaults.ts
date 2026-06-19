import type { QaConfig } from "./qaConfig.types";

/** LG.com Akamai 봇 차단 우회용 Chromium User-Agent */
const DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * QA 기본 설정 — `qa/qa.config.ts` 에서 spread 후 필요한 항목만 덮어쓴다.
 * 동작은 리팩토링 전 하드코딩 값과 동일하게 유지한다.
 */
export function createDefaultQaConfig(): QaConfig {
    return {
        page: {
            lgComOrigin: "https://www.lg.com",
            aboutLgBusinessPath: "/business/about-lg-business/",
            defaultBaselineUrl: "https://www.lg.com/global/business/about-lg-business/",
            businessAreaRootSelector: ".business-area",
            cookieBannerSelectors: [
                "#onetrust-accept-btn-handler",
                'button:has-text("Accept All")',
                'button:has-text("Accept all")',
                'button:has-text("Accept")',
                'button:has-text("Agree")',
                'button:has-text("I Agree")',
                ".cmp-button--accept-all",
            ],
            linkExtractSelector: "a[href]",
        },
        excel: {
            placeholderMapPath: "assets/business-area-template.placeholder-map.config.json",
            baselineSheetKey: "global",
            localeSheetResolve: "exact-then-prefix",
            ignoreValues: ["", "N/A", "NA", "-", "—"],
            validateSheetLayout: true,
            parse: {
                cellDates: true,
                useFormattedCellValue: true,
            },
        },
        translation: {
            columnToPanelId: {
                D: "eco-solution",
                E: "vehicle-solution",
                F: "media-entertainment-solution",
                G: "home-appliance-solution",
            },
            matchPriority: ["aria-label", "alt", "text"],
            stableClassPrefixes: ["cmp-", "c-text-", "accordion-", "business-area"],
            unstableIdPattern: "swiper|uuid|random",
            stableAnchorIdPatterns: ["^business-area-", "^tab-", "-solution$"],
        },
        domPrepare: {
            enabled: true,
            scrollAfterSteps: true,
            steps: [
                {
                    type: "click-tab-panels",
                    tabLocatorPatterns: [
                        "[data-hq-panel-id=\"{panelId}\"]",
                        "#tab-{panelId}",
                        "[role=\"tab\"][aria-controls=\"{panelId}\"]",
                    ],
                    expandTriggersAfterClick: {
                        triggerSelector:
                            ".business-area__accordion .accordion-item:not(.active) .accordion-button",
                        repeatUntilNone: true,
                        maxIterations: 12,
                    },
                },
            ],
        },
        links: {
            enabled: {
                localePathRules: true,
                navigationCheck: true,
            },
            rules: {
                blankTargetMustUseGlobal: true,
                sameTabMustUseLocale: true,
                globalPageNonGlobalLinks: "warn",
                skipNonLgComLinks: true,
            },
            lgComHrefPattern: "^(https?:)?\\/\\/(www\\.)?lg\\.com\\/",
            navigation: {
                activateTabBeforeBlankClick: true,
                tabLocatorPatterns: [
                    "[data-hq-panel-id=\"{panelId}\"]",
                    "#tab-{panelId}",
                    "[role=\"tab\"][aria-controls=\"{panelId}\"]",
                ],
                blankClickFallbackGoto: true,
            },
        },
        phases: {
            translation: true,
            linkLocaleRules: true,
            linkNavigation: true,
        },
        timeouts: {
            pageGotoMs: 90_000,
            pageGotoWaitUntil: "domcontentloaded",
            postGotoHydrationMs: 2_000,
            businessAreaRootMs: 45_000,
            businessAreaScopeDefaultMs: 90_000,
            primaryAttachedWaitCapMs: 15_000,
            scopePollIntervalMs: 1_500,
            scrollPauseMs: 120,
            cookieBannerVisibleMs: 800,
            cookieBannerClickMs: 3_000,
            cookieBannerPostClickMs: 400,
            linkPopupWaitMs: 15_000,
            linkClickMs: 10_000,
            linkPopupLoadMs: 20_000,
            linkSameTabGotoMs: 30_000,
            /** 탭·아코디언 클릭 후 DOM 반영 대기(ms) */
            prepareInteractionPauseMs: 350,
            prepareClickTimeoutMs: 4_000,
            prepareScrollTimeoutMs: 2_500,
        },
        browser: {
            headless: false,
            viewport: { width: 1920, height: 1080 },
            locale: "en-US",
            userAgent: DEFAULT_USER_AGENT,
            args: [
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ],
            hideWebdriver: true,
            extraHTTPHeaders: {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Upgrade-Insecure-Requests": "1",
            },
            httpErrorThreshold: 400,
            accessDeniedTitlePattern: "access denied",
        },
    };
}

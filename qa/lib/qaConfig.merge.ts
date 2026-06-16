import type { QaConfig } from "./qaConfig.types";

/** 깊은 merge — 사용자 override 가 기본값을 부분 덮어쓴다 */
export function mergeQaConfig(base: QaConfig, override: Partial<QaConfig>): QaConfig {
    return {
        page: { ...base.page, ...override.page },
        excel: {
            ...base.excel,
            ...override.excel,
            ignoreValues: override.excel?.ignoreValues ?? base.excel.ignoreValues,
            parse: { ...base.excel.parse, ...override.excel?.parse },
        },
        translation: {
            ...base.translation,
            ...override.translation,
            columnToPanelId: {
                ...base.translation.columnToPanelId,
                ...override.translation?.columnToPanelId,
            },
            matchPriority: override.translation?.matchPriority ?? base.translation.matchPriority,
            stableClassPrefixes:
                override.translation?.stableClassPrefixes ?? base.translation.stableClassPrefixes,
        },
        links: {
            enabled: { ...base.links.enabled, ...override.links?.enabled },
            rules: { ...base.links.rules, ...override.links?.rules },
            lgComHrefPattern: override.links?.lgComHrefPattern ?? base.links.lgComHrefPattern,
        },
        phases: { ...base.phases, ...override.phases },
        timeouts: { ...base.timeouts, ...override.timeouts },
        browser: {
            ...base.browser,
            ...override.browser,
            viewport: { ...base.browser.viewport, ...override.browser?.viewport },
            extraHTTPHeaders: {
                ...base.browser.extraHTTPHeaders,
                ...override.browser?.extraHTTPHeaders,
            },
            args: override.browser?.args ?? base.browser.args,
        },
    };
}

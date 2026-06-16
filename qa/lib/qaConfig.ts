import { mergeQaConfig } from "./qaConfig.merge";
import type { QaConfig } from "./qaConfig.types";
import { qaConfig as userQaConfig } from "../qa.config";

export type { QaConfig } from "./qaConfig.types";
export type {
    GlobalPageLinkMismatch,
    LocaleSheetResolveMode,
    QaBrowserConfig,
    QaExcelConfig,
    QaExcelParseConfig,
    QaLinksConfig,
    QaPageConfig,
    QaPhasesConfig,
    QaTimeoutsConfig,
    QaTranslationConfig,
} from "./qaConfig.types";
export { createDefaultQaConfig } from "./qaConfig.defaults";

/** lg.com href 판별 RegExp — config.links.lgComHrefPattern 기준 */
export function compileLgComHrefPattern(config: QaConfig): RegExp {
    return new RegExp(config.links.lgComHrefPattern, "i");
}

/** lg.com 링크 여부 (상대 경로 `/` 시작 포함) */
export function isLgComHrefByConfig(href: string, config: QaConfig): boolean {
    return compileLgComHrefPattern(config).test(href) || href.startsWith("/");
}

let runtimeOverride: Partial<QaConfig> | undefined;

/** 런타임 config 덮어쓰기 (2차 UI 연동용) */
export function setQaConfigOverride(override: Partial<QaConfig> | undefined): void {
    runtimeOverride = override;
}

export function resetQaConfigOverride(): void {
    runtimeOverride = undefined;
}

/**
 * 최종 QA 설정 — `qa/qa.config.ts` + 런타임 override.
 * `runBusinessAreaQa` options.config 가 있으면 그 값을 우선한다.
 */
export function resolveQaConfig(options?: { config?: QaConfig; override?: Partial<QaConfig> }): QaConfig {
    if (options?.config) {
        if (options.override) {
            return mergeQaConfig(options.config, options.override);
        }
        return options.config;
    }

    if (runtimeOverride) {
        return mergeQaConfig(userQaConfig, runtimeOverride);
    }
    return userQaConfig;
}

/** run 옵션 없을 때 단축 */
export function getQaConfig(): QaConfig {
    return resolveQaConfig();
}

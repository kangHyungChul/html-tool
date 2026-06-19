import type { Locator, Page } from "playwright";

import { scrollPageForLazyContent } from "./businessAreaScope";
import { getQaConfig, type QaConfig } from "./qaConfig";
import type {
    QaDomPrepareClickEachStep,
    QaDomPrepareClickTabPanelsStep,
    QaDomPrepareExpandTriggersStep,
    QaDomPrepareStep,
} from "./qaConfig.types";

export interface PrepareScopeForQaOptions {
    /** UI·스트림 진행 메시지 */
    onProgress?: (message: string) => void;
}

function cfg(config?: QaConfig): QaConfig {
    return config ?? getQaConfig();
}

function pause(page: Page, ms: number): Promise<void> {
    return page.waitForTimeout(ms);
}

/** `{panelId}` 치환으로 탭 locator 후보 생성 */
function buildTabLocator(scope: Locator, panelId: string, patterns: string[]): Locator {
    const selectors = patterns.map((p) => p.replace(/\{panelId\}/g, panelId));
    return scope.locator(selectors.join(", ")).first();
}

/** tabpanel id 목록 — step.panelIds 또는 translation.columnToPanelId */
function resolvePanelIds(step: QaDomPrepareClickTabPanelsStep, config: QaConfig): string[] {
    if (step.panelIds && step.panelIds.length > 0) {
        return step.panelIds;
    }
    const fromColumns = Object.values(config.translation.columnToPanelId).filter(Boolean);
    return [...new Set(fromColumns)];
}

/** hidden 요소 scroll 대기로 멈추지 않도록 짧은 timeout + 필요 시 force click */
async function interactClick(
    locator: Locator,
    config: QaConfig,
    options?: { force?: boolean },
): Promise<void> {
    const clickTimeout = config.timeouts.prepareClickTimeoutMs;
    const scrollTimeout = config.timeouts.prepareScrollTimeoutMs;
    const force = options?.force ?? false;

    if (!force) {
        await locator.scrollIntoViewIfNeeded({ timeout: scrollTimeout }).catch(() => undefined);
    }
    await locator.click({ timeout: clickTimeout, force }).catch(() => undefined);
}

async function runExpandTriggersStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareExpandTriggersStep,
    config: QaConfig,
    options?: PrepareScopeForQaOptions,
): Promise<void> {
    const pauseMs = config.timeouts.prepareInteractionPauseMs;
    const maxIterations = step.maxIterations ?? 20;
    const useForceClick = step.forceClick ?? false;

    if (step.repeatUntilNone) {
        for (let i = 0; i < maxIterations; i += 1) {
            const triggers = scope.locator(step.triggerSelector);
            const count = await triggers.count();
            if (count === 0) {
                break;
            }
            options?.onProgress?.(`접힌 구역 펼치기 (${i + 1}/${maxIterations})…`);
            await interactClick(triggers.first(), config, { force: useForceClick });
            await pause(page, pauseMs);
        }
        return;
    }

    const triggers = scope.locator(step.triggerSelector);
    const count = await triggers.count();
    for (let i = 0; i < count; i += 1) {
        options?.onProgress?.(`클릭 대상 (${i + 1}/${count})…`);
        await interactClick(triggers.nth(i), config, { force: useForceClick });
        await pause(page, pauseMs);
    }
}

async function runClickTabPanelsStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareClickTabPanelsStep,
    config: QaConfig,
    options?: PrepareScopeForQaOptions,
): Promise<void> {
    const patterns = step.tabLocatorPatterns ?? [
        "[data-hq-panel-id=\"{panelId}\"]",
        "#tab-{panelId}",
        "[role=\"tab\"][aria-controls=\"{panelId}\"]",
    ];
    const pauseMs = config.timeouts.prepareInteractionPauseMs;
    const panelIds = resolvePanelIds(step, config);

    for (let i = 0; i < panelIds.length; i += 1) {
        const panelId = panelIds[i];
        options?.onProgress?.(`탭 전환 (${i + 1}/${panelIds.length}): ${panelId}`);

        const tab = buildTabLocator(scope, panelId, patterns);
        if ((await tab.count()) === 0) {
            continue;
        }
        await interactClick(tab, config);
        await pause(page, pauseMs);

        /** 탭별로 해당 tabpanel 내부만 펼치기 — hidden 패널 scroll 대기 멈춤 방지 */
        if (step.expandTriggersAfterClick) {
            const panelScope = scope.locator(
                `#${panelId}, [role="tabpanel"][id="${panelId}"]`,
            );
            if ((await panelScope.count()) > 0) {
                await runExpandTriggersStep(
                    page,
                    panelScope,
                    {
                        type: "expand-triggers",
                        ...step.expandTriggersAfterClick,
                    },
                    config,
                    options,
                );
            }
        }
    }
}

async function runClickEachStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareClickEachStep,
    config: QaConfig,
    options?: PrepareScopeForQaOptions,
): Promise<void> {
    const pauseMs = config.timeouts.prepareInteractionPauseMs;
    const targets = scope.locator(step.selector);
    const count = await targets.count();

    if (count === 0 && !step.optional) {
        return;
    }

    for (let i = 0; i < count; i += 1) {
        options?.onProgress?.(`클릭 (${i + 1}/${count})…`);
        await interactClick(targets.nth(i), config, { force: step.forceClick });
        await pause(page, pauseMs);
    }
}

async function runPrepareStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareStep,
    config: QaConfig,
    options?: PrepareScopeForQaOptions,
): Promise<void> {
    switch (step.type) {
        case "click-tab-panels":
            await runClickTabPanelsStep(page, scope, step, config, options);
            break;
        case "expand-triggers":
            await runExpandTriggersStep(page, scope, step, config, options);
            break;
        case "click-each":
            await runClickEachStep(page, scope, step, config, options);
            break;
        default:
            break;
    }
}

/**
 * QA DOM 매핑·번역 검증 전 scope 내 인터랙션을 수행한다.
 * - `qaConfig.domPrepare` 단계 정의 (탭·아코디언·커스텀 클릭 시퀀스)
 */
export async function prepareScopeForQa(
    page: Page,
    scope: Locator,
    config?: QaConfig,
    options?: PrepareScopeForQaOptions,
): Promise<void> {
    const c = cfg(config);
    const { domPrepare } = c;

    if (!domPrepare.enabled || domPrepare.steps.length === 0) {
        if (domPrepare.scrollAfterSteps) {
            options?.onProgress?.("lazy-load 스크롤…");
            await scrollPageForLazyContent(page, c);
        }
        return;
    }

    for (let i = 0; i < domPrepare.steps.length; i += 1) {
        const step = domPrepare.steps[i];
        options?.onProgress?.(`DOM 전개 step ${i + 1}/${domPrepare.steps.length} (${step.type})…`);
        await runPrepareStep(page, scope, step, c, options);
    }

    if (domPrepare.scrollAfterSteps) {
        options?.onProgress?.("lazy-load 스크롤…");
        await scrollPageForLazyContent(page, c);
    }
}

/** @deprecated `prepareScopeForQa` 사용 */
export const prepareBusinessAreaForQa = prepareScopeForQa;

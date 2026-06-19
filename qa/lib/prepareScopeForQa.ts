import type { Locator, Page } from "playwright";

import { scrollPageForLazyContent } from "./businessAreaScope";
import { getQaConfig, type QaConfig } from "./qaConfig";
import type {
    QaDomPrepareClickEachStep,
    QaDomPrepareClickTabPanelsStep,
    QaDomPrepareExpandTriggersStep,
    QaDomPrepareStep,
} from "./qaConfig.types";

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

async function runClickTabPanelsStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareClickTabPanelsStep,
    config: QaConfig,
): Promise<void> {
    const patterns = step.tabLocatorPatterns ?? [
        "[data-hq-panel-id=\"{panelId}\"]",
        "#tab-{panelId}",
        "[role=\"tab\"][aria-controls=\"{panelId}\"]",
    ];
    const clickTimeout = config.timeouts.prepareClickTimeoutMs;
    const pauseMs = config.timeouts.prepareInteractionPauseMs;

    for (const panelId of resolvePanelIds(step, config)) {
        const tab = buildTabLocator(scope, panelId, patterns);
        if ((await tab.count()) === 0) {
            continue;
        }
        await tab.scrollIntoViewIfNeeded().catch(() => undefined);
        await tab.click({ timeout: clickTimeout }).catch(() => undefined);
        await pause(page, pauseMs);
    }
}

async function runExpandTriggersStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareExpandTriggersStep,
    config: QaConfig,
): Promise<void> {
    const clickTimeout = config.timeouts.prepareClickTimeoutMs;
    const pauseMs = config.timeouts.prepareInteractionPauseMs;
    const maxIterations = step.maxIterations ?? 40;

    if (step.repeatUntilNone) {
        for (let i = 0; i < maxIterations; i += 1) {
            const triggers = scope.locator(step.triggerSelector);
            if ((await triggers.count()) === 0) {
                break;
            }
            const trigger = triggers.first();
            await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
            await trigger.click({ timeout: clickTimeout }).catch(() => undefined);
            await pause(page, pauseMs);
        }
        return;
    }

    const triggers = scope.locator(step.triggerSelector);
    const count = await triggers.count();
    for (let i = 0; i < count; i += 1) {
        const trigger = triggers.nth(i);
        await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
        await trigger.click({ timeout: clickTimeout }).catch(() => undefined);
        await pause(page, pauseMs);
    }
}

async function runClickEachStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareClickEachStep,
    config: QaConfig,
): Promise<void> {
    const clickTimeout = config.timeouts.prepareClickTimeoutMs;
    const pauseMs = config.timeouts.prepareInteractionPauseMs;
    const targets = scope.locator(step.selector);
    const count = await targets.count();

    if (count === 0 && !step.optional) {
        return;
    }

    for (let i = 0; i < count; i += 1) {
        const target = targets.nth(i);
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        await target.click({ timeout: clickTimeout }).catch(() => undefined);
        await pause(page, pauseMs);
    }
}

async function runPrepareStep(
    page: Page,
    scope: Locator,
    step: QaDomPrepareStep,
    config: QaConfig,
): Promise<void> {
    switch (step.type) {
        case "click-tab-panels":
            await runClickTabPanelsStep(page, scope, step, config);
            break;
        case "expand-triggers":
            await runExpandTriggersStep(page, scope, step, config);
            break;
        case "click-each":
            await runClickEachStep(page, scope, step, config);
            break;
        default:
            break;
    }
}

/**
 * QA DOM 매핑·번역 검증 전 scope 내 인터랙션을 수행한다.
 * - `qaConfig.domPrepare` 단계 정의 (탭·아코디언·커스텀 클릭 시퀀스)
 * - 다른 페이지·컴포넌트 QA 시 `qa.config.ts` 에서 steps 만 교체
 */
export async function prepareScopeForQa(
    page: Page,
    scope: Locator,
    config?: QaConfig,
): Promise<void> {
    const c = cfg(config);
    const { domPrepare } = c;

    if (!domPrepare.enabled || domPrepare.steps.length === 0) {
        if (domPrepare.scrollAfterSteps) {
            await scrollPageForLazyContent(page, c);
        }
        return;
    }

    for (const step of domPrepare.steps) {
        await runPrepareStep(page, scope, step, c);
    }

    if (domPrepare.scrollAfterSteps) {
        await scrollPageForLazyContent(page, c);
    }
}

/** @deprecated `prepareScopeForQa` 사용 */
export const prepareBusinessAreaForQa = prepareScopeForQa;

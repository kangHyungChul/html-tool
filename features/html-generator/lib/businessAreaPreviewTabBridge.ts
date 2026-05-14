/**
 * mapped HTML을 수정하지 않고, 미리보기 iframe 안의 Business Area 탭과
 * React(우측「셀 값 편집」섹션 탭)을 맞추기 위한 브리지.
 *
 * - 부모 → iframe: 템플릿이 등록한 위임 클릭 핸들러가 실행되도록 **실제 탭 DOM에 .click()** 을 보낸다.
 * - iframe → 부모: 탭 활성 상태가 바뀔 때(클릭·키보드 등) **MutationObserver** 로 `aria-selected` / class 변화를 감지한다.
 */

/** `adaptPlaceholderMapToCellMap` 이 만든 `sections[].key` → 템플릿 `data-hq-panel-id` / 패널 `id` (고정, 템플릿 DOM과 일치해야 함) */
export const PREVIEW_PANEL_ID_BY_SECTION_KEY: Record<string, string> = {
    ecoSolution: "eco-solution",
    vehicleSolution: "vehicle-solution",
    mediaEntertainmentSolution: "media-entertainment-solution",
    homeApplianceSolution: "home-appliance-solution",
};

/** 패널 id → config 섹션 key (역방향) */
const SECTION_KEY_BY_PREVIEW_PANEL_ID: Record<string, string> = Object.fromEntries(
    Object.entries(PREVIEW_PANEL_ID_BY_SECTION_KEY).map(([k, v]) => [v, k]),
);

export function sectionKeyFromPreviewPanelId(panelId: string): string | undefined {
    return SECTION_KEY_BY_PREVIEW_PANEL_ID[panelId];
}

/** `.business-area` 중 tablist를 포함한 루트를 찾는다(템플릿의 hqBusinessFindSection과 동일한 의도). */
function findBusinessAreaRoot(doc: Document): Element | null {
    const areas = doc.querySelectorAll(".business-area");
    for (let i = 0; i < areas.length; i++) {
        const el = areas[i];
        if (el.querySelector('.c-tabs__list[role="tablist"]')) {
            return el;
        }
    }
    return areas[0] ?? null;
}

/** 탭 한 칸에서 패널 id를 읽는다(템플릿 pidOf와 동일 규칙). */
function panelIdFromTabEl(tab: Element): string {
    return (
        tab.getAttribute("data-hq-panel-id") ||
        tab.getAttribute("aria-controls") ||
        (tab.id || "").replace(/^tab-/, "") ||
        ""
    );
}

/**
 * Swiper 중복 슬라이드 제외 + 동일 pid 중복 제거 후, 사용자에게 보이는 탭만 순서대로 반환한다.
 * (템플릿 `liveTabs` 와 동일한 필터 의도)
 */
function liveTabElements(tablist: Element): HTMLElement[] {
    const all = tablist.querySelectorAll(".c-tabs__item");
    const out: HTMLElement[] = [];
    const seen: Record<string, boolean> = Object.create(null);
    for (let i = 0; i < all.length; i++) {
        const t = all[i] as HTMLElement;
        if (t.classList.contains("swiper-slide-duplicate")) {
            continue;
        }
        const p = panelIdFromTabEl(t);
        if (!p || seen[p]) {
            continue;
        }
        seen[p] = true;
        out.push(t);
    }
    return out;
}

function getTabList(doc: Document): Element | null {
    const root = findBusinessAreaRoot(doc);
    if (!root) {
        return null;
    }
    return root.querySelector('.c-tabs__list[role="tablist"]');
}

/**
 * 미리보기 iframe에서 해당 패널 탭을 **프로그램 클릭**하여 템플릿 스크립트가 전환·비디오 동기화까지 수행하게 한다.
 * @returns 해당 패널 탭을 찾아 클릭까지 시도했으면 true
 */
export function clickPreviewTabByPanelId(iframe: HTMLIFrameElement, panelId: string): boolean {
    const doc = iframe.contentDocument;
    if (!doc || !panelId) {
        return false;
    }
    const list = getTabList(doc);
    if (!list) {
        return false;
    }
    const tabs = liveTabElements(list);
    for (let i = 0; i < tabs.length; i++) {
        if (panelIdFromTabEl(tabs[i]) === panelId) {
            tabs[i].click();
            return true;
        }
    }
    return false;
}

/** 현재 활성으로 보이는 탭의 패널 id(없으면 null). */
export function readActivePreviewPanelId(iframe: HTMLIFrameElement): string | null {
    const doc = iframe.contentDocument;
    if (!doc) {
        return null;
    }
    const list = getTabList(doc);
    if (!list) {
        return null;
    }
    const tabs = liveTabElements(list);
    for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        if (t.classList.contains("is-business-tab-active") || t.getAttribute("aria-selected") === "true") {
            const pid = panelIdFromTabEl(t);
            return pid || null;
        }
    }
    if (tabs[0]) {
        return panelIdFromTabEl(tabs[0]) || null;
    }
    return null;
}

/**
 * iframe 문서 안 tablist의 속성 변화를 구독해, 활성 패널 id가 바뀔 때마다 콜백을 호출한다.
 * @returns 구독 해제 함수
 */
export function attachPreviewTabActiveObserver(
    iframe: HTMLIFrameElement,
    onPanelId: (panelId: string) => void,
): () => void {
    const doc = iframe.contentDocument;
    if (!doc) {
        return () => {};
    }
    const list = getTabList(doc);
    if (!list) {
        return () => {};
    }

    let rafId = 0;
    const flush = () => {
        const pid = readActivePreviewPanelId(iframe);
        if (pid) {
            onPanelId(pid);
        }
    };
    const schedule = () => {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            flush();
        });
    };

    const mo = new MutationObserver(schedule);
    mo.observe(list, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-selected"],
    });
    schedule();

    return () => {
        mo.disconnect();
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
    };
}

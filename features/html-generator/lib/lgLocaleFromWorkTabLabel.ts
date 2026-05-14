/**
 * 워크 탭 라벨(엑셀 시트명·`Default`)과 `locale-map.json` 을 연결한다.
 * - 미리보기 `<html lang>` · `data-countrycode`
 * - LG 사이트 URL 경로 세그먼트(`global` → `uk` 등) — `rewriteLgComGlobalPathToLocale` 에 넘길 키
 */

import localeMapJson from "@/features/html-generator/constants/locale-map.json";

type LocaleMapEntry = { lang?: string; country?: string };
type LocaleMapJson = Record<string, LocaleMapEntry>;

const LOCALE_MAP = localeMapJson as LocaleMapJson;

/**
 * 워크 탭 라벨(엑셀 시트명·`Default`)을 `locale-map.json` 키로 정규화한다.
 * - `Default` / 기본 탭 → 글로벌 미리보기이므로 `global`
 * - 동일 시트 복수 탭: `global_en (2)` → 괄호·번호 제거 후 `global_en`
 * - 키 비교는 소문자(`ca_en`, `be_fr` 등 엑셀 시트명과 맞춤)
 */
export function normalizeWorkTabLabelToLocaleLookupKey(label: string): string {
    const t = label.trim();
    if (/^default$/i.test(t)) {
        return "global";
    }
    return t.replace(/\s*\(\d+\)\s*$/, "").trim().toLowerCase();
}

/**
 * `locale-map.json` 에서 쓸 **키**를 고른다.
 * - 전체 문자열이 맵에 없으면 `global_en` → `global` 처럼 첫 `_` 앞 접두어만 한 번 더 시도한다.
 */
export function resolveLocaleMapKeyForWorkTab(label: string): string {
    const base = normalizeWorkTabLabelToLocaleLookupKey(label);
    if (LOCALE_MAP[base] != null) {
        return base;
    }
    const u = base.indexOf("_");
    if (u > 0) {
        const prefix = base.slice(0, u);
        if (LOCALE_MAP[prefix] != null) {
            return prefix;
        }
    }
    return "global";
}

/**
 * 미리보기 루트 `<html>` 의 `lang`·`data-countrycode` 값.
 * - `locale-map.json` 의 해당 키에서 읽는다.
 * - 항목이 없거나 `lang`·`country` 가 비어 있으면 **`global`** 항목으로 폴백한다.
 */
export function getPreviewLocaleAttrsForWorkTabLabel(label: string): { lang: string; country: string } {
    const key = resolveLocaleMapKeyForWorkTab(label);
    const globalEntry = LOCALE_MAP.global;
    const fallbackLang = (globalEntry?.lang ?? "en-GLOBAL").trim() || "en-GLOBAL";
    const fallbackCountry = (globalEntry?.country ?? "global").trim() || "global";

    const entry = LOCALE_MAP[key];
    const langEmpty = !entry?.lang?.trim();
    const countryEmpty = !entry?.country?.trim();
    if (!entry || (langEmpty && countryEmpty)) {
        return { lang: fallbackLang, country: fallbackCountry };
    }
    return {
        lang: langEmpty ? fallbackLang : entry.lang!.trim(),
        country: countryEmpty ? fallbackCountry : entry.country!.trim(),
    };
}

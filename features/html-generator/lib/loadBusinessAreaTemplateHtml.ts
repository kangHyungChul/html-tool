/**
 * Business Area용 템플릿 조각을 둘로 나눠 불러온다.
 *
 * - `commonHead`: LG 글로벌 공통 CSS 링크 + `.ST0002` 최소 스타일. 여러 템플릿에서 재사용.
 * - `mappedBody`: `{D6}` 등 셀 placeholder가 있는 본문.
 *
 * 사용처 구분(요구사항):
 * - **HTML 코드 / 파일 다운로드**: `mappedBody`만 치환한 문자열을 쓴다. 공통 헤드는 “결과 코드”에 포함하지 않는다.
 * - **iframe 미리보기**: 브라우저에서 스타일이 보이도록 `commonHead + mappedBody(치환 후)`를 `srcDoc`에 넣는다.
 */

/** 공통: 외부 스타일시트 링크 + ST0002 높이 보정 등 */
const COMMON_HEAD_FRAGMENT_URL = "/templates/business-area.common-head-fragment.html";

/** 셀 placeholder가 들어 있는 mapped 본문(헤드 조각 제외) */
const MAPPED_BODY_URL = "/templates/business-area.cell-placeholder.mapped.html";

export interface BusinessAreaTemplateParts {
    /** 미리보기 전용. 코드/다운로드 결과에는 넣지 않는다. */
    commonHead: string;
    /** placeholder 치환 대상 본문 */
    mappedBody: string;
}

/**
 * 공통 헤드 조각과 mapped 본문을 각각 fetch한다.
 * @throws fetch 실패 시 Error (상태 코드 포함)
 */
export async function loadBusinessAreaTemplateParts(): Promise<BusinessAreaTemplateParts> {
    const [headResponse, bodyResponse] = await Promise.all([
        fetch(COMMON_HEAD_FRAGMENT_URL),
        fetch(MAPPED_BODY_URL),
    ]);

    if (!headResponse.ok) {
        throw new Error(`공통 헤드 조각을 불러오지 못했습니다 (${headResponse.status})`);
    }

    if (!bodyResponse.ok) {
        throw new Error(`mapped 템플릿을 불러오지 못했습니다 (${bodyResponse.status})`);
    }

    const commonHead = (await headResponse.text()).trimEnd();
    const mappedBody = await bodyResponse.text();

    return { commonHead, mappedBody };
}

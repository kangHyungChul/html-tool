/**
 * DOM 셀렉터 앵커 id 판별 — `qaConfig.translation` 규칙을 Node·브라우저 evaluate 공통으로 사용.
 */

/** unstable id 패턴 + stable 앵커 패턴으로 id 가 셀렉터 루트에 쓸 만한지 판별 */
export function isStableAnchorId(
    id: string,
    stableAnchorIdPatterns: string[],
    unstableIdPattern: string,
): boolean {
    if (!id) {
        return false;
    }
    const unstableRe = new RegExp(unstableIdPattern, "i");
    if (unstableRe.test(id)) {
        return false;
    }
    for (const pattern of stableAnchorIdPatterns) {
        if (new RegExp(pattern, "i").test(id)) {
            return true;
        }
    }
    return false;
}

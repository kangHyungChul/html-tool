/**
 * 템플릿 문자열에서 `{D6}`, `{E10}` 형태의 셀 placeholder를 모두 찾는다.
 *
 * 중복 정책: 템플릿에 등장하는 **첫 등장 순서**를 유지하며, 동일 셀은 한 번만 배열에 넣는다.
 * (검증·디버그 UI 등에서 “어떤 셀이 쓰였는지” 순서 있게 보여주기 위함)
 */
export function getUsedPlaceholders(template: string): string[] {
    const re = /\{([A-Z]+[0-9]+)\}/g;
    const seen = new Set<string>();
    const ordered: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = re.exec(template)) !== null) {
        const cell = match[1];
        if (!seen.has(cell)) {
            seen.add(cell);
            ordered.push(cell);
        }
    }

    return ordered;
}

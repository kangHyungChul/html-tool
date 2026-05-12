/**
 * 엑셀/textarea에서 온 사용자 입력을 HTML에 안전하게 넣기 위한 이스케이프.
 * CONTEXT.md의 Escape Policy와 동일한 규칙을 따른다.
 */

/**
 * HTML 특수문자를 엔티티로 치환한다. (텍스트 노드/속성 값용)
 */
export function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/**
 * escapeHtml 이후 줄바꿈 문자를 `<br />`로 바꾼다.
 * 본문처럼 여러 줄이 허용되는 필드(multiline)에 사용한다.
 */
export function escapeHtmlWithLineBreak(value: string): string {
    return escapeHtml(value).replaceAll("\n", "<br />");
}

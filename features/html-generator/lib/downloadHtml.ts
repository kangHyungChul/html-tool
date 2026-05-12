/**
 * 생성된 HTML 문자열을 브라우저에서 `.html` 파일로 저장한다.
 * Blob + 임시 앵커 클릭 방식(서버 저장 없음).
 */
export function downloadHtml(params: { html: string; fileName: string }): void {
    const { html, fileName } = params;
    const safeName = fileName.toLowerCase().endsWith(".html") ? fileName : `${fileName}.html`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName;
    anchor.rel = "noopener";
    anchor.click();

    URL.revokeObjectURL(url);
}

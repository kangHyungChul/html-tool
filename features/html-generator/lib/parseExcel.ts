import type { WorkBook } from "xlsx";

/**
 * 업로드된 .xlsx 파일을 브라우저 메모리에서만 읽어 SheetJS Workbook으로 변환한다.
 * 서버로 파일을 보내지 않는다(CONTEXT.md).
 *
 * `read`를 동적 import로 불러오는 이유:
 * - 초기 번들에서 xlsx 청크를 분리해 첫 화면 로딩을 조금이라도 가볍게 하기 위함(완벽한 트리 쉐이킹은 아님).
 * - SheetJS는 용량이 크므로, 엑셀을 올릴 때까지 메인 스레드 파싱 비용을 늦출 수 있다.
 *
 * `cellDates: true`:
 * - 엑셀 날짜 셀을 JS Date로 보존하려는 옵션이다.
 * - 본 앱은 최종적으로 문자열만 쓰지만, format_cell 경로와의 일관성을 위해 켜 둔다.
 */
export async function parseExcel(file: File): Promise<WorkBook> {
    const { read } = await import("xlsx");
    const buffer = await file.arrayBuffer();
    return read(buffer, { type: "array", cellDates: true });
}

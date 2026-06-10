import fs from "node:fs";
import path from "node:path";

import { QA_PACKAGE_ROOT } from "./projectRoot";

/** 번들·exe 배포에 포함되는 정적 자산 경로 */
export function resolveBundledAsset(fileName: string): string {
    return path.join(QA_PACKAGE_ROOT, "assets", fileName);
}

/** placeholder-map JSON (엑셀 양식·셀 매핑 단일 소스) */
export function loadPlaceholderMapJson(): unknown {
    const filePath = resolveBundledAsset("business-area-template.placeholder-map.config.json");
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/** Business Area HTML 템플릿 (셀→DOM 셀렉터 생성용) */
export function getTemplateHtmlPath(): string {
    return resolveBundledAsset("business-area.template.html");
}

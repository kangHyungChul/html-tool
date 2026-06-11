import type { NextConfig } from "next";
import path from "node:path";

const rootPlaywright = path.join(process.cwd(), "node_modules", "playwright");
const rootPlaywrightCore = path.join(process.cwd(), "node_modules", "playwright-core");

const nextConfig: NextConfig = {
    /* Playwright는 Node 전용 — qa/node_modules 경로로 번들되면 chromium-bidi 해석 실패 */
    serverExternalPackages: ["playwright", "playwright-core"],
    webpack: (config, { isServer }) => {
        if (isServer) {
            config.resolve.alias = {
                ...config.resolve.alias,
                playwright: rootPlaywright,
                "playwright-core": rootPlaywrightCore,
            };
        }
        return config;
    },
};

export default nextConfig;

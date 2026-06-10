import { chromium } from "playwright";

const url = "https://www.lg.com/global/business/about-lg-business/";

async function probe(label: string, launchOpts: Parameters<typeof chromium.launch>[0], ctxOpts?: Parameters<ReturnType<typeof chromium.launch>["then"]>): Promise<void> {
    void ctxOpts;
}

async function testCase(
    label: string,
    setup: (browser: Awaited<ReturnType<typeof chromium.launch>>) => Promise<{ status: number; title: string; ba: number }>,
    launchOptions?: Parameters<typeof chromium.launch>[0],
): Promise<void> {
    const browser = await chromium.launch({
        headless: true,
        ...launchOptions,
    });
    try {
        const result = await setup(browser);
        console.log(`[${label}] status=${result.status} title=${result.title} .business-area=${result.ba}`);
    } finally {
        await browser.close();
    }
}

async function main(): Promise<void> {
    const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    await testCase("default headless", async (browser) => {
        const page = await browser.newPage();
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        return {
            status: res?.status() ?? 0,
            title: await page.title(),
            ba: await page.locator(".business-area").count(),
        };
    });

    await testCase(
        "stealth args",
        async (browser) => {
            const context = await browser.newContext({
                userAgent: ua,
                locale: "en-US",
                viewport: { width: 1920, height: 1080 },
                extraHTTPHeaders: {
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                    "Sec-Ch-Ua-Mobile": "?0",
                    "Sec-Ch-Ua-Platform": '"Windows"',
                    "Upgrade-Insecure-Requests": "1",
                },
            });
            await context.addInitScript(() => {
                Object.defineProperty(navigator, "webdriver", { get: () => undefined });
            });
            const page = await context.newPage();
            const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForTimeout(2000);
            return {
                status: res?.status() ?? 0,
                title: await page.title(),
                ba: await page.locator(".business-area").count(),
            };
        },
        {
            args: [
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ],
        },
    );

    await testCase(
        "headless=false",
        async (browser) => {
            const context = await browser.newContext({ userAgent: ua, locale: "en-US" });
            const page = await context.newPage();
            const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForTimeout(3000);
            for (const sel of ["#onetrust-accept-btn-handler", 'button:has-text("Accept all")']) {
                const btn = page.locator(sel).first();
                if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await btn.click().catch(() => undefined);
                    break;
                }
            }
            await page.waitForTimeout(2000);
            return {
                status: res?.status() ?? 0,
                title: await page.title(),
                ba: await page.locator(".business-area").count(),
            };
        },
        { headless: false },
    );

    await testCase(
        "channel chrome",
        async (browser) => {
            const page = await browser.newPage({ userAgent: ua });
            const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForTimeout(2000);
            return {
                status: res?.status() ?? 0,
                title: await page.title(),
                ba: await page.locator(".business-area").count(),
            };
        },
        { channel: "chrome", headless: true },
    );
}

main().catch(console.error);

import { gotoQaTargetPage, waitForBusinessAreaScope } from "../lib/businessAreaScope";
import { launchQaBrowser } from "../lib/playwrightBrowser";

const url = "https://www.lg.com/global/business/about-lg-business/";

async function main(): Promise<void> {
    const { browser, context } = await launchQaBrowser();
    const page = await context.newPage();

    try {
        await gotoQaTargetPage(page, url);
        const scope = await waitForBusinessAreaScope(page, { timeoutMs: 30_000 });
        console.log("OK:", scope.selector, "count:", await scope.locator.count());
        console.log("title:", await page.title());
    } finally {
        await browser.close();
    }
}

main().catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
});

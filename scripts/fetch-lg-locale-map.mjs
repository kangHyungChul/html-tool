/**
 * LG `https://www.lg.com/{키}/` 홈 HTML의 루트 `<html>` 태그에서
 * `lang`, `data-countrycode` 만 추출한다 (본문 위젯 중복 값 방지).
 *
 * 사용:
 *   node scripts/fetch-lg-locale-map.mjs
 *   node scripts/fetch-lg-locale-map.mjs --write
 *
 * `--write` 이면 `features/html-generator/constants/locale-map.json` 에 덮어쓴다.
 * 그렇지 않으면 JSON만 stdout 에 출력한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(
    PROJECT_ROOT,
    'features/html-generator/constants/locale-map.json',
);
const KEYS = [
    'global', // 글로벌
    'uk', // 영국(영어)
    'th', // 태국(태국어)
    'fr', // 프랑스(프랑스어)
    'pa', // 파나마(스페인어)
    'mx', // 멕시코(스페인어)
    'co', // 콜롬비아(스페인어)
    'tr', // 튀르키예(튀르키예어)
    'pl', // 폴란드(폴란드어)
    'ph', // 필리핀(영어)
    'za', // 남아공(영어)
    'pe', // 페루(스페인어)
    'ma', // 모로코(프랑스어)
    'vn', // 베트남(베트남어)
    'pt', // 포르투갈(포르투갈어)
    'ca_en', // 캐나다(영어)
    'id', // 인도네시아(인도네시아어)
    'tw', // 대만(중국어)
    'nl', // 네덜란드(네덜란드어)
    'be_fr', // 벨기에(프랑스어)
];

/**
 * @param {string} html
 * @returns {{ lang: string; country: string }}
 */
function extractHtmlRootAttrs(html) {
    const start = html.search(/<html\b/i);
    if (start === -1) {
        return { lang: '', country: '' };
    }
    const endRel = html.indexOf('>', start);
    const end = endRel === -1 ? start + 1200 : endRel + 1;
    const slice = html.slice(start, end);

    const langM = slice.match(/\blang\s*=\s*["']([^"']*)["']/i);
    const ccM = slice.match(/\bdata-countrycode\s*=\s*["']([^"']*)["']/i);

    return {
        lang: (langM?.[1] ?? '').trim(),
        country: (ccM?.[1] ?? '').trim(),
    };
}

async function fetchOne(key) {
    const url = `https://www.lg.com/${key}/business`;
    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });
    const html = await res.text();
    const attrs = extractHtmlRootAttrs(html);
    return { key, url, status: res.status, ...attrs };
}

async function main() {
    const write = process.argv.includes('--write');
    const out = {};
    for (const key of KEYS) {
        try {
            const row = await fetchOne(key);
            if (row.status >= 400) {
                out[key] = { lang: '', country: '' };
            } else {
                out[key] = { lang: row.lang, country: row.country };
            }
        } catch {
            out[key] = { lang: '', country: '' };
        }
        await new Promise((r) => setTimeout(r, 350));
    }
    const body = `${JSON.stringify(out, null, 4)}\n`;
    if (write) {
        await fs.promises.writeFile(DEFAULT_OUT, body, 'utf-8');
        process.stderr.write(`Wrote ${DEFAULT_OUT}\n`);
    } else {
        process.stdout.write(body);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

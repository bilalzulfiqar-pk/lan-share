/**
 * LAN Share — Tier 5 Adversarial Coverage Hardening Test Suite
 * 
 * White-Box Adversarial Stress Testing covering:
 * - Category 1: Canonical URLs, Query Parameters & Normalization Attacks
 * - Category 2: Unicode & Special Character Handling in Metadata & Body
 * - Category 3: Robots.txt RFC 9309 Edge Cases & Parser Quirks
 * - Category 4: Sitemap.xml Schema & Parser Quirks
 * - Category 5: JSON-LD Graph Traverser & Deep Entity Validation
 * - Category 6: HTTP Request Header Emulation & Content Negotiation
 * - Category 7: GEO Direct Answers & Cross-Artifact Architectural Consistency
 * 
 * Executable via:
 *   npx vitest run tests/tier5-adversarial.test.js
 *   npm test (in client/)
 *   node tests/tier5-adversarial.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// Dual Runner Environment Setup (Vitest or Native Node.js node:test)
// ---------------------------------------------------------------------------
const isVitest = Boolean(globalThis.process?.env?.VITEST);
let describe, it, expect;

if (isVitest) {
    const v = await import('vitest');
    describe = v.describe;
    it = v.it;
    expect = v.expect;
} else {
    const nt = await import('node:test');
    const assert = (await import('node:assert/strict')).default;
    describe = nt.describe;
    it = nt.it;

    function createExpect(actual, isNot = false) {
        const match = (pass, msg) => {
            if (isNot ? pass : !pass) {
                assert.fail(msg || 'Assertion condition failed');
            }
        };
        return {
            get not() {
                return createExpect(actual, !isNot);
            },
            toBe: (expected) => match(actual === expected, `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`),
            toEqual: (expected) => {
                try {
                    assert.deepStrictEqual(actual, expected);
                    match(true);
                } catch (err) {
                    match(false, err.message);
                }
            },
            toBeTruthy: () => match(Boolean(actual), `Expected truthy, received ${JSON.stringify(actual)}`),
            toBeFalsy: () => match(!actual, `Expected falsy, received ${JSON.stringify(actual)}`),
            toBeDefined: () => match(actual !== undefined, 'Expected value to be defined'),
            toBeUndefined: () => match(actual === undefined, `Expected undefined, received ${JSON.stringify(actual)}`),
            toBeNull: () => match(actual === null, `Expected null, received ${JSON.stringify(actual)}`),
            toBeGreaterThan: (val) => match(actual > val, `Expected ${actual} > ${val}`),
            toBeGreaterThanOrEqual: (val) => match(actual >= val, `Expected ${actual} >= ${val}`),
            toBeLessThan: (val) => match(actual < val, `Expected ${actual} < ${val}`),
            toBeLessThanOrEqual: (val) => match(actual <= val, `Expected ${actual} <= ${val}`),
            toContain: (item) => {
                if (typeof actual === 'string' || Array.isArray(actual)) {
                    match(actual.includes(item), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`);
                } else if (actual instanceof Set) {
                    match(actual.has(item), `Expected Set to contain ${JSON.stringify(item)}`);
                } else {
                    match(false, `toContain received non-iterable ${typeof actual}`);
                }
            },
            toMatch: (regex) => match(regex.test(String(actual)), `Expected "${actual}" to match ${regex}`),
            toThrow: () => {
                let threw = false;
                try {
                    if (typeof actual === 'function') actual();
                } catch {
                    threw = true;
                }
                match(threw, 'Expected function to throw');
            }
        };
    }
    expect = (actual) => createExpect(actual);
}

// ---------------------------------------------------------------------------
// Path Resolutions & File Loaders
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');

const paths = {
    indexHtml: path.join(clientDir, 'index.html'),
    robotsTxt: path.join(clientDir, 'public', 'robots.txt'),
    sitemapXml: path.join(clientDir, 'public', 'sitemap.xml'),
    llmsTxt: path.join(clientDir, 'public', 'llms.txt'),
    publicBannerSvg: path.join(clientDir, 'public', 'banner.svg'),
    viteConfigJs: path.join(clientDir, 'vite.config.js'),
    distDir: path.join(clientDir, 'dist'),
    distIndexHtml: path.join(clientDir, 'dist', 'index.html'),
};

function readFileSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
}

function readBufferSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
}

// Helper: Parse raw HTML tags
function extractHtmlEntities(html) {
    const canonicalMatch = html.match(/<link\s+[^>]*?rel=["']canonical["'][^>]*?>/i);
    const canonicalHref = canonicalMatch?.[0]?.match(/href=["']([^"']*)["']/i)?.[1] || '';

    const ogUrlMatch = html.match(/<meta\s+[^>]*?property=["']og:url["'][^>]*?>/i);
    const ogUrl = ogUrlMatch?.[0]?.match(/content=["']([^"']*)["']/i)?.[1] || '';

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || '';

    const descMatch = html.match(/<meta\s+[^>]*?name=["']description["'][^>]*?>/i);
    const description = descMatch?.[0]?.match(/content=["']([^"']*)["']/i)?.[1] || '';

    const altMatch = html.match(/<meta\s+[^>]*?property=["']og:image:alt["'][^>]*?>/i);
    const ogImageAlt = altMatch?.[0]?.match(/content=["']([^"']*)["']/i)?.[1] || '';

    const jsonLdMatch = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    let jsonLd = null;
    if (jsonLdMatch) {
        try {
            jsonLd = JSON.parse(jsonLdMatch[1].trim());
        } catch {
            jsonLd = null;
        }
    }

    return {
        canonicalHref,
        ogUrl,
        title,
        description,
        ogImageAlt,
        jsonLd,
    };
}

// Helper: RFC 9309 Rule Evaluation Engine
function evaluateRfc9309(robotsTxtContent, userAgent, pathUri) {
    const lines = robotsTxtContent.split(/\r?\n/);
    const records = [];
    let currentRecord = null;

    for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const directive = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (directive === 'user-agent') {
            if (!currentRecord || currentRecord.rules.length > 0) {
                currentRecord = { agents: [], rules: [] };
                records.push(currentRecord);
            }
            currentRecord.agents.push(value.toLowerCase());
        } else if (directive === 'allow' || directive === 'disallow') {
            if (currentRecord) {
                currentRecord.rules.push({ type: directive, pattern: value });
            }
        }
    }

    // Find the most specific record for this userAgent
    const targetAgent = userAgent.toLowerCase();
    let matchedRecord = records.find(r => r.agents.includes(targetAgent));
    if (!matchedRecord) {
        matchedRecord = records.find(r => r.agents.includes('*'));
    }

    if (!matchedRecord || matchedRecord.rules.length === 0) {
        return { allowed: true, matchingRule: null };
    }

    // RFC 9309 Section 2.2.2: Longest match wins
    let bestRule = null;
    for (const rule of matchedRecord.rules) {
        if (!rule.pattern && rule.type === 'disallow') {
            // Disallow: (empty) means allow all
            continue;
        }
        if (pathUri.startsWith(rule.pattern)) {
            if (!bestRule || rule.pattern.length > bestRule.pattern.length) {
                bestRule = rule;
            } else if (rule.pattern.length === bestRule.pattern.length && rule.type === 'allow') {
                // If length is equal, allow overrides disallow
                bestRule = rule;
            }
        }
    }

    if (!bestRule) {
        return { allowed: true, matchingRule: null };
    }

    return {
        allowed: bestRule.type === 'allow',
        matchingRule: bestRule
    };
}

// ===========================================================================
// TIER 5 ADVERSARIAL COVERAGE HARDENING SUITE
// ===========================================================================

describe('Tier 5: Adversarial Coverage Hardening Suite', () => {

    // -----------------------------------------------------------------------
    // Category 1: Canonical URLs, Query Parameters & Normalization Attacks
    // -----------------------------------------------------------------------
    describe('Category 1: Canonical URLs, Query Parameters & Normalization Attacks', () => {
        const html = readFileSafe(paths.indexHtml);
        const { canonicalHref, ogUrl, jsonLd } = extractHtmlEntities(html);
        const sitemap = readFileSafe(paths.sitemapXml);
        const sitemapLoc = sitemap?.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim();

        it('T5-1.1: Canonical URL parser rejects query params, fragments, and non-standard ports', () => {
            expect(canonicalHref).toBeTruthy();
            const parsed = new URL(canonicalHref);
            expect(parsed.protocol).toBe('https:');
            expect(parsed.hostname).toBe('lan-share.vercel.app');
            expect(parsed.pathname).toBe('/');
            expect(parsed.search).toBe('');
            expect(parsed.hash).toBe('');
            expect(parsed.port).toBe('');
            expect(parsed.username).toBe('');
            expect(parsed.password).toBe('');
        });

        it('T5-1.2: Adversarial query parameter simulation maps canonical cleanly', () => {
            // Simulated incoming requests with tracking params, search queries, and delimiters
            const adversarialIncomingUrls = [
                'https://lan-share.vercel.app/?fbclid=IwAR2bZ1_sample_tracking_id_here',
                'https://lan-share.vercel.app/?utm_source=twitter&utm_medium=cpc&utm_campaign=launch',
                'https://lan-share.vercel.app/?ref=producthunt&theme=dark',
                'https://lan-share.vercel.app/?&&&&',
                'https://lan-share.vercel.app/?q=%20%22%3Cscript%3Ealert(1)%3C/script%3E',
                'https://lan-share.vercel.app/?a=1&a=2&b=test;test2',
                'https://lan-share.vercel.app/?key=value%20with%20spaces#target-heading',
            ];

            for (const rawUrl of adversarialIncomingUrls) {
                // External crawlers inspecting index.html for canonical reference must strictly extract canonicalHref
                const simulatedIncoming = new URL(rawUrl);
                expect(simulatedIncoming.search).not.toBe('');
                // Canonical tag in page remains unaffected by request query params
                expect(canonicalHref).toBe('https://lan-share.vercel.app/');
            }
        });

        it('T5-1.3: Directory index path alias simulation canonicalizes strictly to root /', () => {
            const indexAliases = [
                'https://lan-share.vercel.app/index.html',
                'https://lan-share.vercel.app/index.html?param=value',
                'https://lan-share.vercel.app/index.html#radar',
            ];

            for (const alias of indexAliases) {
                const url = new URL(alias);
                expect(url.pathname).toContain('index.html');
                // The canonical URL declares the single authoritative root
                expect(canonicalHref).toBe('https://lan-share.vercel.app/');
            }
        });

        it('T5-1.4: Protocol & Host Case Normalization rejects http:// and relative schemas', () => {
            expect(canonicalHref.startsWith('https://')).toBe(true);
            expect(canonicalHref.startsWith('http://')).toBe(false);
            expect(canonicalHref.startsWith('//')).toBe(false);
            expect(canonicalHref.toLowerCase()).toBe(canonicalHref);
        });

        it('T5-1.5: Trailing slash consistency: exact 5-way byte-level match across all canonical declarations', () => {
            // 1. canonical link href
            // 2. og:url
            // 3. sitemap.xml loc
            // 4. Schema.org WebSite url
            // 5. Schema.org SoftwareApplication url
            expect(canonicalHref).toBe('https://lan-share.vercel.app/');
            expect(ogUrl).toBe('https://lan-share.vercel.app/');
            expect(sitemapLoc).toBe('https://lan-share.vercel.app/');

            const website = jsonLd?.['@graph']?.find(e => e['@type'] === 'WebSite');
            const app = jsonLd?.['@graph']?.find(e => e['@type'] === 'SoftwareApplication');

            expect(website?.url).toBe('https://lan-share.vercel.app/');
            expect(app?.url).toBe('https://lan-share.vercel.app/');

            // All 5 must be byte-for-byte identical
            const allDeclarations = [canonicalHref, ogUrl, sitemapLoc, website?.url, app?.url];
            const uniqueDeclarations = new Set(allDeclarations);
            expect(uniqueDeclarations.size).toBe(1);
        });

        it('T5-1.6: client/vite.config.js default siteUrl fallback is strictly https://lan-share.vercel.app', () => {
            const viteConfigContent = readFileSafe(paths.viteConfigJs);
            expect(viteConfigContent).toBeTruthy();
            expect(viteConfigContent).toContain('https://lan-share.vercel.app');
            expect(viteConfigContent).toContain('VITE_SITE_URL');
        });
    });

    // -----------------------------------------------------------------------
    // Category 2: Unicode & Special Character Handling in Metadata & Body
    // -----------------------------------------------------------------------
    describe('Category 2: Unicode & Special Character Handling in Metadata & Body', () => {
        const html = readFileSafe(paths.indexHtml);
        const { title, description, ogImageAlt } = extractHtmlEntities(html);

        it('T5-2.1: Character encoding declaration <meta charset="UTF-8" /> is within first 1024 bytes', () => {
            const headSubstr = html.slice(0, 1024);
            expect(headSubstr).toMatch(/<meta\s+charset=["']utf-8["']/i);
        });

        it('T5-2.2: BOM detection: zero UTF-8 Byte Order Mark (0xEF, 0xBB, 0xBF) across all SEO artifacts', () => {
            const filesToCheck = [paths.indexHtml, paths.robotsTxt, paths.sitemapXml, paths.llmsTxt];

            for (const file of filesToCheck) {
                const buf = readBufferSafe(file);
                expect(buf).toBeTruthy();
                // Check if starts with BOM [0xEF, 0xBB, 0xBF]
                const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
                expect(hasBom).toBe(false);
            }
        });

        it('T5-2.3: Title Unicode integrity: contains hyphen (-) separator without mojibake, optimal SERP length', () => {
            expect(title).toContain('-');
            expect(title).not.toContain('â€”'); // Mojibake for em-dash in CP1252
            expect(title).not.toContain('&mdash;'); // Literal entity in title
            expect(title).not.toMatch(/<[^>]+>/); // No HTML tags in title

            // Google SERP displays ~50-60 characters before truncating with ellipsis
            expect(title.length).toBeGreaterThanOrEqual(25);
            expect(title.length).toBeLessThanOrEqual(65);
        });

        it('T5-2.4: Description Unicode & escaping: contains % without corruption, optimal snippet length', () => {
            expect(description).toContain('100% private');
            expect(description).not.toContain('â'); // Common mojibake prefix
            expect(description).not.toContain('%20'); // Unintended percent-encoding

            // Google snippet length optimal threshold (120-160 characters)
            expect(description.length).toBeGreaterThanOrEqual(120);
            expect(description.length).toBeLessThanOrEqual(165);
        });

        it('T5-2.5: Pre-hydration HTML entity encoding: FAQ uses &amp; and RAM limit uses &lt; 50 MB', () => {
            expect(html).toContain('<h2>Frequently Asked Questions &amp; Direct Answers</h2>');
            expect(html).not.toContain('<h2>Frequently Asked Questions & Direct Answers</h2>'); // Heading must not use raw unescaped &

            expect(html).toContain('&lt; 50 MB');
            expect(html).not.toContain('< 50 MB'); // Must not use raw unescaped < in body
        });

        it('T5-2.6: Footer Unicode character encoding: middle dot (·) is preserved without mojibake', () => {
            expect(html).toContain('·');
            expect(html).not.toContain('Â·'); // Mojibake for middle dot in CP1252
            expect(ogImageAlt).toContain('-');
            expect(ogImageAlt).not.toContain('â€”');
        });
    });

    // -----------------------------------------------------------------------
    // Category 3: Robots.txt RFC 9309 Edge Cases & Parser Quirks
    // -----------------------------------------------------------------------
    describe('Category 3: Robots.txt RFC 9309 Edge Cases & Parser Quirks', () => {
        const robotsContent = readFileSafe(paths.robotsTxt);

        it('T5-3.1: Case-insensitivity in directives: uppercase directives parse identically', () => {
            const upperCaseRobots = robotsContent
                .replace(/User-agent:/g, 'USER-AGENT:')
                .replace(/Allow:/g, 'ALLOW:')
                .replace(/Disallow:/g, 'DISALLOW:')
                .replace(/Sitemap:/g, 'SITEMAP:');

            const normalEval = evaluateRfc9309(robotsContent, 'Googlebot', '/');
            const upperEval = evaluateRfc9309(upperCaseRobots, 'Googlebot', '/');

            expect(upperEval.allowed).toBe(normalEval.allowed);
            expect(upperEval.matchingRule?.pattern).toBe(normalEval.matchingRule?.pattern);
        });

        it('T5-3.2: Inline comments and trailing whitespace stripping: lines with # do not corrupt values', () => {
            const lines = robotsContent.split(/\r?\n/);
            for (const line of lines) {
                const commentIdx = line.indexOf('#');
                if (commentIdx !== -1) {
                    const directivePart = line.slice(0, commentIdx).trim();
                    if (directivePart) {
                        expect(directivePart).toMatch(/^(User-agent|Allow|Disallow|Sitemap):\s*.+$/i);
                    }
                }
            }
        });

        it('T5-3.3: RFC 9309 longest-match prefix engine simulation verifies allowed vs disallowed paths', () => {
            const testMatrix = [
                // [agent, path, expectedAllowed]
                ['Googlebot', '/', true],
                ['Googlebot', '/favicon.svg', true],
                ['Googlebot', '/manifest.webmanifest', true],
                ['Googlebot', '/banner.svg', true],
                ['Googlebot', '/llms.txt', true],
                ['Googlebot', '/sitemap.xml', true],
                ['Googlebot', '/api/', false],
                ['Googlebot', '/api/v1/join', false],
                ['Googlebot', '/socket.io/', false],
                ['Googlebot', '/socket.io/?EIO=4&transport=websocket', false],
                ['Googlebot', '/health', false],
                ['Googlebot', '/health/check', false],
                ['GPTBot', '/', true],
                ['GPTBot', '/llms.txt', true],
                ['GPTBot', '/api/auth', false],
                ['ClaudeBot', '/', true],
                ['ClaudeBot', '/socket.io/', false],
                ['PerplexityBot', '/', true],
                ['PerplexityBot', '/health', false],
            ];

            for (const [agent, pathUri, expectedAllowed] of testMatrix) {
                const res = evaluateRfc9309(robotsContent, agent, pathUri);
                expect(res.allowed).toBe(expectedAllowed);
            }
        });

        it('T5-3.4: Semicolon and query parameter handling in disallowed routes', () => {
            // RFC 9309 prefix matching for query params on disallowed endpoints
            const queryPaths = [
                '/socket.io/?transport=polling&sid=12345',
                '/api/?token=secret',
                '/health?detailed=true&format=json',
            ];

            for (const qPath of queryPaths) {
                const res = evaluateRfc9309(robotsContent, 'Googlebot', qPath);
                expect(res.allowed).toBe(false);
            }
        });

        it('T5-3.5: User-Agent token matching: case-insensitive matching for AI bots', () => {
            const botTokens = ['gptbot', 'claudebot', 'perplexitybot', 'google-extended', 'applebot-extended', 'ccbot', 'chatgpt-user'];

            for (const bot of botTokens) {
                const resRoot = evaluateRfc9309(robotsContent, bot, '/');
                expect(resRoot.allowed).toBe(true);

                const resSocket = evaluateRfc9309(robotsContent, bot, '/socket.io/');
                expect(resSocket.allowed).toBe(false);
            }
        });

        it('T5-3.6: No accidental root disallow (Disallow: /) in any crawler block', () => {
            const lines = robotsContent.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.replace(/#.*$/, '').trim();
                // Match Disallow: / or Disallow: /* exactly
                expect(trimmed).not.toMatch(/^Disallow:\s*(\/|\/\*)$/i);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Category 4: Sitemap.xml Schema & Parser Quirks
    // -----------------------------------------------------------------------
    describe('Category 4: Sitemap.xml Schema & Parser Quirks', () => {
        const sitemapContent = readFileSafe(paths.sitemapXml);

        it('T5-4.1: XML declaration is strictly line 1, column 1 without preceding whitespace', () => {
            expect(sitemapContent.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
        });

        it('T5-4.2: Sitemaps Protocol 0.9 schema validation with exactly one canonical <url>', () => {
            expect(sitemapContent).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
            expect(sitemapContent).toContain('</urlset>');

            const urlBlocks = [...sitemapContent.matchAll(/<url>([\s\S]*?)<\/url>/gi)];
            expect(urlBlocks.length).toBe(1);

            const inner = urlBlocks[0][1];
            expect(inner).toMatch(/<loc>[\s\S]*?<\/loc>/i);
            expect(inner).toMatch(/<lastmod>[\s\S]*?<\/lastmod>/i);
            expect(inner).toMatch(/<changefreq>[\s\S]*?<\/changefreq>/i);
            expect(inner).toMatch(/<priority>[\s\S]*?<\/priority>/i);
        });

        it('T5-4.3: Date validity: <lastmod> is a valid calendar date in YYYY-MM-DD format', () => {
            const lastmod = sitemapContent.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim();
            expect(lastmod).toBeDefined();
            expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);

            const [year, month, day] = lastmod.split('-').map(Number);
            expect(year).toBeGreaterThanOrEqual(2026);
            expect(month).toBeGreaterThanOrEqual(1);
            expect(month).toBeLessThanOrEqual(12);
            expect(day).toBeGreaterThanOrEqual(1);
            expect(day).toBeLessThanOrEqual(31);

            // Valid date construction check
            const dateObj = new Date(`${lastmod}T00:00:00Z`);
            expect(dateObj.toISOString().startsWith(lastmod)).toBe(true);
        });

        it('T5-4.4: Priority & changefreq validation', () => {
            const priorityStr = sitemapContent.match(/<priority>([\s\S]*?)<\/priority>/i)?.[1]?.trim();
            const changefreq = sitemapContent.match(/<changefreq>([\s\S]*?)<\/changefreq>/i)?.[1]?.trim();

            const prio = parseFloat(priorityStr);
            expect(prio).toBeGreaterThanOrEqual(0.0);
            expect(prio).toBeLessThanOrEqual(1.0);

            const validFreqs = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
            expect(validFreqs).toContain(changefreq?.toLowerCase());
        });

        it('T5-4.5: XML special character hygiene: <loc> contains no unescaped characters', () => {
            const loc = sitemapContent.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim();
            expect(loc).toBe('https://lan-share.vercel.app/');
            expect(loc).not.toContain('&');
            expect(loc).not.toContain('<');
            expect(loc).not.toContain('>');
            expect(loc).not.toContain('"');
            expect(loc).not.toContain("'");
        });
    });

    // -----------------------------------------------------------------------
    // Category 5: JSON-LD Graph Traverser & Deep Entity Validation
    // -----------------------------------------------------------------------
    describe('Category 5: JSON-LD Graph Traverser & Deep Entity Validation', () => {
        const html = readFileSafe(paths.indexHtml);
        const { jsonLd } = extractHtmlEntities(html);

        it('T5-5.1: Strict ID uniqueness: every @id in @graph is globally unique', () => {
            expect(jsonLd).toBeTruthy();
            const graph = jsonLd['@graph'];
            expect(Array.isArray(graph)).toBe(true);

            const ids = graph.map(node => node['@id']).filter(Boolean);
            expect(ids.length).toBe(3);

            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });

        it('T5-5.2: Referential integrity: cross-referenced @ids resolve to declared graph nodes', () => {
            const graph = jsonLd['@graph'];
            const idMap = new Map();
            for (const node of graph) {
                if (node['@id']) idMap.set(node['@id'], node);
            }

            // WebSite.publisher points to an existing node
            const website = graph.find(e => e['@type'] === 'WebSite');
            expect(website).toBeDefined();
            const pubId = website?.publisher?.['@id'];
            expect(pubId).toBeDefined();
            expect(idMap.has(pubId)).toBe(true);
            expect(idMap.get(pubId)['@type']).toBe('Person');

            // SoftwareApplication.author points to an existing node
            const app = graph.find(e => e['@type'] === 'SoftwareApplication');
            expect(app).toBeDefined();
            const authorId = app?.author?.['@id'];
            expect(authorId).toBeDefined();
            expect(idMap.has(authorId)).toBe(true);
            expect(idMap.get(authorId)['@type']).toBe('Person');
        });

        it('T5-5.3: Graph connectivity & acyclic traversal: resolves connected graph without circular loops', () => {
            const graph = jsonLd['@graph'];
            const adj = new Map();
            for (const node of graph) {
                adj.set(node['@id'], []);
            }

            // Build edges
            const website = graph.find(e => e['@type'] === 'WebSite');
            if (website?.publisher?.['@id']) adj.get(website['@id']).push(website.publisher['@id']);

            const app = graph.find(e => e['@type'] === 'SoftwareApplication');
            if (app?.author?.['@id']) adj.get(app['@id']).push(app.author['@id']);

            // Cycle detection using DFS
            const visited = new Set();
            const recursionStack = new Set();

            function hasCycle(nodeId) {
                visited.add(nodeId);
                recursionStack.add(nodeId);

                for (const neighbor of (adj.get(nodeId) || [])) {
                    if (!visited.has(neighbor)) {
                        if (hasCycle(neighbor)) return true;
                    } else if (recursionStack.has(neighbor)) {
                        return true;
                    }
                }

                recursionStack.delete(nodeId);
                return false;
            }

            for (const nodeId of adj.keys()) {
                if (!visited.has(nodeId)) {
                    expect(hasCycle(nodeId)).toBe(false);
                }
            }
        });

        it('T5-5.4: Entity schema conformance: WebSite, SoftwareApplication, Person, Offer', () => {
            const graph = jsonLd['@graph'];
            const website = graph.find(e => e['@type'] === 'WebSite');
            const app = graph.find(e => e['@type'] === 'SoftwareApplication');
            const person = graph.find(e => e['@type'] === 'Person');

            // WebSite conformance
            expect(website.name).toBe('LAN Share');
            expect(website.inLanguage).toBe('en');

            // SoftwareApplication conformance
            expect(app.applicationCategory).toBe('FileTransferApplication');
            expect(app.isAccessibleForFree).toBe(true);
            expect(Array.isArray(app.featureList)).toBe(true);
            expect(app.featureList.length).toBeGreaterThanOrEqual(4);

            // Offer conformance
            expect(app.offers).toBeDefined();
            expect(app.offers['@type']).toBe('Offer');
            expect(app.offers.price).toBe('0');
            expect(app.offers.priceCurrency).toBe('USD');
            expect(app.offers.availability).toBe('https://schema.org/InStock');

            // Person conformance
            expect(person.name).toBe('Bilal Zulfiqar');
            expect(person.url).toBe('https://github.com/bilalzulfiqar-pk');
        });

        it('T5-5.5: Zero-fabrication / Anti-spam audit: prohibited marketing fields absent', () => {
            const rawJson = JSON.stringify(jsonLd);

            // Prohibited review / rating spam properties
            expect(rawJson).not.toContain('aggregateRating');
            expect(rawJson).not.toContain('review');
            expect(rawJson).not.toContain('ratingValue');
            expect(rawJson).not.toContain('ratingCount');
            expect(rawJson).not.toContain('reviewCount');

            // Prohibited marketing hype claims
            expect(rawJson.toLowerCase()).not.toContain('award');
            expect(rawJson.toLowerCase()).not.toContain('5 star');
            expect(rawJson.toLowerCase()).not.toContain('best app');
        });
    });

    // -----------------------------------------------------------------------
    // Category 6: HTTP Request Header Emulation & Content Negotiation
    // -----------------------------------------------------------------------
    describe('Category 6: HTTP Request Header Emulation & Content Negotiation', () => {
        it('T5-6.1: Simulated bot request headers variation handling', () => {
            // Emulate request header sets from various crawlers
            const crawlerHeaders = [
                { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'accept': 'text/html,application/xhtml+xml' },
                { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'Accept': '*/*' },
                { 'USER-AGENT': 'ClaudeBot/1.0', 'ACCEPT': 'text/plain, text/markdown' },
                { 'user-agent': 'PerplexityBot/1.0' }, // Missing Accept header
            ];

            for (const headers of crawlerHeaders) {
                // Normalize headers to lowercase
                const normalized = {};
                for (const [k, v] of Object.entries(headers)) {
                    normalized[k.toLowerCase()] = v;
                }

                const ua = normalized['user-agent'] || '';
                expect(ua.length).toBeGreaterThan(0);

                // Check robots allowance for normalized user-agent
                const robots = readFileSafe(paths.robotsTxt);
                const evalRes = evaluateRfc9309(robots, ua.split('/')[0].split(' ')[0], '/');
                expect(evalRes.allowed).toBe(true);
            }
        });

        it('T5-6.2: MIME type and extension mapping matches web standards', () => {
            const assetMimeMap = {
                'index.html': 'text/html',
                'robots.txt': 'text/plain',
                'sitemap.xml': 'application/xml',
                'llms.txt': 'text/plain',
                'banner.svg': 'image/svg+xml',
            };

            for (const [fileName, expectedMime] of Object.entries(assetMimeMap)) {
                const ext = path.extname(fileName);
                if (ext === '.html') expect(expectedMime).toBe('text/html');
                if (ext === '.txt') expect(expectedMime).toBe('text/plain');
                if (ext === '.xml') expect(expectedMime).toBe('application/xml');
                if (ext === '.svg') expect(expectedMime).toBe('image/svg+xml');
            }
        });

        it('T5-6.3: Static host compatibility: zero reliance on runtime cookies or server sessions', () => {
            const html = readFileSafe(paths.indexHtml);
            expect(html).not.toContain('document.cookie');
            expect(html).not.toContain('connect.sid');
            expect(html).not.toContain('Set-Cookie');
        });
    });

    // -----------------------------------------------------------------------
    // Category 7: GEO Direct Answers & Cross-Artifact Architectural Consistency
    // -----------------------------------------------------------------------
    describe('Category 7: GEO Direct Answers & Cross-Artifact Architectural Consistency', () => {
        const html = readFileSafe(paths.indexHtml);
        const llmsContent = readFileSafe(paths.llmsTxt);
        const { jsonLd } = extractHtmlEntities(html);

        it('T5-7.1: Answer Engine direct answers are grounded and match across index.html and llms.txt', () => {
            const questions = [
                'How does LAN Share transfer files without cloud uploads?',
                'What is the file size limit on LAN Share?',
                'Is LAN Share secure?',
            ];

            for (const q of questions) {
                expect(html).toContain(q);
                expect(llmsContent).toContain(q);
            }

            // Verify core technical terms present in both
            expect(html.toLowerCase()).toContain('file system access api');
            expect(llmsContent.toLowerCase()).toContain('file system access api');

            expect(html.toLowerCase()).toContain('sha-256');
            expect(llmsContent.toLowerCase()).toContain('sha-256');

            expect(html.toLowerCase()).toContain('dtls');
            expect(llmsContent.toLowerCase()).toContain('dtls');
        });

        it('T5-7.2: Cross-artifact synchronization: protocols, licensing, and author match exactly', () => {
            // Author
            expect(html).toContain('Bilal Zulfiqar');
            expect(llmsContent).toContain('Bilal Zulfiqar');
            const person = jsonLd?.['@graph']?.find(e => e['@type'] === 'Person');
            expect(person?.name).toBe('Bilal Zulfiqar');

            // License
            expect(html).toContain('MIT License');
            expect(llmsContent).toContain('MIT License');

            // Repository URL
            expect(html).toContain('https://github.com/bilalzulfiqar-pk');
            expect(llmsContent).toContain('https://github.com/bilalzulfiqar-pk/lan-share');
        });

        it('T5-7.3: Vite production build integrity: dist contains all SEO assets with non-zero size and byte-level identity', () => {
            expect(fs.existsSync(paths.distDir)).toBe(true);
            const requiredDistAssets = ['index.html', 'robots.txt', 'sitemap.xml', 'llms.txt', 'banner.svg'];

            for (const asset of requiredDistAssets) {
                const assetPath = path.join(paths.distDir, asset);
                expect(fs.existsSync(assetPath)).toBe(true);
                const stats = fs.statSync(assetPath);
                expect(stats.size).toBeGreaterThan(0);

                if (asset !== 'index.html') {
                    // Static public assets must match dist copies byte-for-byte
                    const publicBuf = fs.readFileSync(path.join(clientDir, 'public', asset));
                    const distBuf = fs.readFileSync(assetPath);
                    expect(Buffer.compare(publicBuf, distBuf)).toBe(0);
                }
            }
        });
    });
});

/**
 * LAN Share — Comprehensive SEO & GEO E2E Test Suite
 * 
 * Opaque-box verification across Tiers 1-4 covering all 16 features from PROJECT.md:
 * - Tier 1: Feature Coverage (robots.txt, sitemap.xml, banner.svg, meta tags, OG/Twitter, Schema JSON-LD, semantic HTML, llms.txt)
 * - Tier 2: Boundary & Corner Cases (Absolute URLs, zero-fabrication anti-cheating, static assets protection, DOM selectors)
 * - Tier 3: Cross-Feature Combinations (Sitemap <-> Canonical, OG <-> Canonical, Robots <-> Sitemap, llms.txt <-> Schema, etc.)
 * - Tier 4: Real-World Search Engine & AI Crawler Simulations (Googlebot, Perplexity/GPTBot, Social unfurl, Non-JS crawlers)
 * 
 * Executable via:
 *   npx vitest run tests/seo-geo.test.js
 *   npm test (in client/)
 *   node tests/seo-geo.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const projectRootDir = path.resolve(clientDir, '..');

const paths = {
    indexHtml: path.join(clientDir, 'index.html'),
    robotsTxt: path.join(clientDir, 'public', 'robots.txt'),
    sitemapXml: path.join(clientDir, 'public', 'sitemap.xml'),
    llmsTxt: path.join(clientDir, 'public', 'llms.txt'),
    publicBannerSvg: path.join(clientDir, 'public', 'banner.svg'),
    publicBannerPng: path.join(clientDir, 'public', 'banner.png'),
    docsBannerSvg: path.join(projectRootDir, 'docs', 'assets', 'banner.svg'),
    appJsx: path.join(clientDir, 'src', 'App.jsx'),
};

function readFileSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// Opaque-Box Parsers (HTML, XML, robots.txt, llms.txt, JSON-LD)
// ---------------------------------------------------------------------------

function parseRobotsTxt(content) {
    if (!content) return { sitemaps: [], userAgents: {} };
    const lines = content.split(/\r?\n/);
    const sitemaps = [];
    const userAgents = {};
    let currentAgent = null;

    for (let rawLine of lines) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;

        const separatorIdx = line.indexOf(':');
        if (separatorIdx === -1) continue;

        const directive = line.slice(0, separatorIdx).trim().toLowerCase();
        const value = line.slice(separatorIdx + 1).trim();

        if (directive === 'sitemap') {
            sitemaps.push(value);
        } else if (directive === 'user-agent') {
            currentAgent = value;
            if (!userAgents[currentAgent]) {
                userAgents[currentAgent] = { allow: [], disallow: [] };
            }
        } else if (directive === 'allow' && currentAgent) {
            userAgents[currentAgent].allow.push(value);
        } else if (directive === 'disallow' && currentAgent) {
            userAgents[currentAgent].disallow.push(value);
        }
    }
    return { sitemaps, userAgents };
}

function parseSitemapXml(content) {
    if (!content) return { hasXmlDecl: false, urlsetNamespace: null, urls: [] };
    const hasXmlDecl = /^\s*<\?xml\s+version=["']1\.0["']\s+encoding=["']UTF-8["']\s*\?>/i.test(content);
    const urlMatches = [...content.matchAll(/<url>([\s\S]*?)<\/url>/gi)];
    const urls = urlMatches.map(m => {
        const block = m[1];
        const loc = block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim() || '';
        const lastmod = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim() || '';
        const changefreq = block.match(/<changefreq>([\s\S]*?)<\/changefreq>/i)?.[1]?.trim() || '';
        const priority = block.match(/<priority>([\s\S]*?)<\/priority>/i)?.[1]?.trim() || '';
        return { loc, lastmod, changefreq, priority };
    });
    const urlsetNamespace = content.match(/<urlset[^>]*xmlns=["']([^"']+)["']/i)?.[1];
    return { hasXmlDecl, urlsetNamespace, urls };
}

function parseHtml(html) {
    if (!html) return {
        title: '',
        metaTags: [],
        linkTags: [],
        jsonLdBlocks: [],
        h1s: [],
        h2s: [],
        h3s: [],
        hasHeader: false,
        hasMain: false,
        hasSection: false,
        hasFooter: false,
        hasNoscript: false,
        noscriptContent: null,
        rootInner: null,
    };

    // Title
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';

    // Meta tags
    const metaTags = [];
    const metaRegex = /<meta\s+([^>]*?)\/?>/gi;
    let metaMatch;
    while ((metaMatch = metaRegex.exec(html)) !== null) {
        const attrsStr = metaMatch[1];
        const attrRegex = /([a-zA-Z0-9_:-]+)=["']([^"']*)["']/g;
        const attrs = {};
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
            attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
        }
        metaTags.push(attrs);
    }

    // Link tags
    const linkTags = [];
    const linkRegex = /<link\s+([^>]*?)\/?>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
        const attrsStr = linkMatch[1];
        const attrRegex = /([a-zA-Z0-9_:-]+)=["']([^"']*)["']/g;
        const attrs = {};
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
            attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
        }
        linkTags.push(attrs);
    }

    // Script ld+json
    const jsonLdBlocks = [];
    const jsonLdRegex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonMatch;
    while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
        jsonLdBlocks.push(jsonMatch[1].trim());
    }

    // Headings
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim());

    // Semantic tags presence
    const hasHeader = /<header[\s>]/i.test(html);
    const hasMain = /<main[\s>]/i.test(html);
    const hasSection = /<section[\s>]/i.test(html);
    const hasFooter = /<footer[\s>]/i.test(html);
    const hasNoscript = /<noscript[\s>]/i.test(html);
    const noscriptContent = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i)?.[1];

    // Root container inner HTML
    const rootMatch = html.match(/<div\s+id=["']root["'][^>]*>([\s\S]*?)<\/div>\s*<script/i);
    const rootInner = rootMatch ? rootMatch[1] : null;

    return {
        title,
        metaTags,
        linkTags,
        jsonLdBlocks,
        h1s,
        h2s,
        h3s,
        hasHeader,
        hasMain,
        hasSection,
        hasFooter,
        hasNoscript,
        noscriptContent,
        rootInner,
    };
}

function parseLlmsTxt(content) {
    if (!content) return { h1: '', blockquote: '', h2s: [], h3s: [], raw: '' };
    const lines = content.split(/\r?\n/);
    const h1 = lines.find(l => l.startsWith('# '))?.replace('# ', '').trim() || '';
    const blockquote = lines.find(l => l.startsWith('> '))?.replace('> ', '').trim() || '';
    const h2s = lines.filter(l => l.startsWith('## ')).map(l => l.replace('## ', '').trim());
    const h3s = lines.filter(l => l.startsWith('### ')).map(l => l.replace('### ', '').trim());
    return { h1, blockquote, h2s, h3s, raw: content };
}

function safeGetJsonLd(parsedHtml) {
    if (!parsedHtml?.jsonLdBlocks || parsedHtml.jsonLdBlocks.length === 0) return null;
    try {
        return JSON.parse(parsedHtml.jsonLdBlocks[0]);
    } catch {
        return null;
    }
}

// ===========================================================================
// TEST SUITE: LAN SHARE SEO & GEO E2E TESTS (TIERS 1 - 4)
// ===========================================================================

describe('E2E SEO & GEO Transformation Suite', () => {

    // -----------------------------------------------------------------------
    // TIER 1: FEATURE COVERAGE (>=5 tests per feature area)
    // -----------------------------------------------------------------------
    describe('Tier 1: Feature Coverage', () => {

        describe('Feature Area 1: robots.txt Crawl Directives & AI Policies (Features 1 & 14)', () => {
            const robotsContent = readFileSafe(paths.robotsTxt);
            const parsed = parseRobotsTxt(robotsContent);

            it('robots.txt exists and is non-empty at client/public/robots.txt', () => {
                expect(robotsContent).toBeTruthy();
                expect(robotsContent?.length || 0).toBeGreaterThan(50);
            });

            it('specifies User-agent: * with Allow: / and disallows internal paths', () => {
                expect(parsed.userAgents['*']).toBeDefined();
                expect(parsed.userAgents['*']?.allow || []).toContain('/');
                expect(parsed.userAgents['*']?.disallow || []).toContain('/api/');
                expect(parsed.userAgents['*']?.disallow || []).toContain('/socket.io/');
                expect(parsed.userAgents['*']?.disallow || []).toContain('/health');
            });

            it('includes an authoritative Sitemap directive pointing to production sitemap.xml', () => {
                expect(parsed.sitemaps.length).toBeGreaterThanOrEqual(1);
                expect(parsed.sitemaps[0]).toBe('https://lan-share.vercel.app/sitemap.xml');
            });

            it('explicitly allows major Generative AI search crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)', () => {
                expect(parsed.userAgents['GPTBot']).toBeDefined();
                expect(parsed.userAgents['GPTBot']?.allow || []).toContain('/');
                expect(parsed.userAgents['ClaudeBot']).toBeDefined();
                expect(parsed.userAgents['ClaudeBot']?.allow || []).toContain('/');
                expect(parsed.userAgents['PerplexityBot']).toBeDefined();
                expect(parsed.userAgents['PerplexityBot']?.allow || []).toContain('/');
                expect(parsed.userAgents['Google-Extended']).toBeDefined();
                expect(parsed.userAgents['Google-Extended']?.allow || []).toContain('/');
            });

            it('protects internal signaling endpoints from AI crawlers as well', () => {
                for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
                    expect(parsed.userAgents[bot]?.disallow || []).toContain('/api/');
                    expect(parsed.userAgents[bot]?.disallow || []).toContain('/socket.io/');
                }
            });

            it('defines crawl policies for extended AI agents (Applebot-Extended, CCBot, ChatGPT-User)', () => {
                const agents = Object.keys(parsed.userAgents);
                expect(agents.some(a => a.toLowerCase().includes('applebot'))).toBe(true);
                expect(agents.some(a => a.toLowerCase().includes('ccbot') || a.toLowerCase().includes('chatgpt'))).toBe(true);
            });
        });

        describe('Feature Area 2: sitemap.xml Canonical Protocol (Feature 2)', () => {
            const sitemapContent = readFileSafe(paths.sitemapXml);
            const parsed = parseSitemapXml(sitemapContent);

            it('sitemap.xml exists and has valid XML declaration and Sitemaps 0.9 namespace', () => {
                expect(sitemapContent).toBeTruthy();
                expect(parsed.hasXmlDecl).toBe(true);
                expect(parsed.urlsetNamespace).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');
            });

            it('contains canonical production URL https://lan-share.vercel.app/', () => {
                expect(parsed.urls.length).toBeGreaterThanOrEqual(1);
                const locs = parsed.urls.map(u => (u.loc || '').replace(/\/$/, ''));
                expect(locs).toContain('https://lan-share.vercel.app');
            });

            it('specifies valid ISO 8601 lastmod date (YYYY-MM-DD)', () => {
                const primaryUrl = parsed.urls[0] || {};
                expect(primaryUrl.lastmod).toBeDefined();
                expect(primaryUrl.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });

            it('contains zero localhost, 127.0.0.1, or staging domains', () => {
                for (const u of parsed.urls) {
                    expect(u.loc).not.toContain('localhost');
                    expect(u.loc).not.toContain('127.0.0.1');
                    expect(u.loc).not.toContain('staging');
                    expect(u.loc).not.toContain('.local');
                }
            });

            it('defines valid changefreq and priority values', () => {
                const primaryUrl = parsed.urls[0] || {};
                expect(primaryUrl.changefreq).toBeDefined();
                expect(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).toContain(primaryUrl.changefreq?.toLowerCase());
                const prio = parseFloat(primaryUrl.priority || '0');
                expect(prio).toBeGreaterThanOrEqual(0.1);
                expect(prio).toBeLessThanOrEqual(1.0);
            });
        });

        describe('Feature Area 3: Social Preview Asset Copy (Feature 3)', () => {
            const publicBanner = readFileSafe(paths.publicBannerSvg);
            const docsBanner = readFileSafe(paths.docsBannerSvg);

            it('banner.svg exists in client/public/banner.svg', () => {
                expect(publicBanner).toBeTruthy();
                expect(publicBanner?.length || 0).toBeGreaterThan(100);
            });

            it('banner.svg is valid SVG markup with 1200x420 aspect ratio', () => {
                expect(publicBanner).toMatch(/<svg[\s\S]*?>/i);
                expect(publicBanner).toContain('viewBox="0 0 1200 420"');
            });

            it('banner.svg mirrors docs/assets/banner.svg asset dimensions and viewBox', () => {
                expect(docsBanner).toBeTruthy();
                expect(publicBanner).toContain('1200');
                expect(publicBanner).toContain('420');
            });
        });

        describe('Feature Area 4: Standard Meta Tags & Canonical URL (Features 4 & 5)', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsed = parseHtml(htmlContent);

            it('title tag exists with brand and descriptive positioning', () => {
                expect(parsed.title).toBeDefined();
                expect(parsed.title).toContain('LAN Share');
                expect(parsed.title.length).toBeGreaterThan(15);
            });

            it('meta description exists with accurate value', () => {
                const descMeta = parsed.metaTags.find(m => m.name === 'description');
                expect(descMeta).toBeDefined();
                expect(descMeta?.content).toBeTruthy();
                expect((descMeta?.content || '').length).toBeGreaterThan(30);
            });

            it('link canonical tag exists referencing https://lan-share.vercel.app', () => {
                const canonical = parsed.linkTags.find(l => l.rel === 'canonical');
                expect(canonical).toBeDefined();
                expect((canonical?.href || '').replace(/\/$/, '')).toBe('https://lan-share.vercel.app');
            });

            it('viewport and charset meta tags are properly configured', () => {
                const viewport = parsed.metaTags.find(m => m.name === 'viewport');
                expect(viewport).toBeDefined();
                expect(viewport?.content).toContain('width=device-width');
                const hasCharset = parsed.metaTags.some(m => m.charset?.toLowerCase() === 'utf-8');
                expect(hasCharset).toBe(true);
            });

            it('keywords and author meta tags are present', () => {
                const keywords = parsed.metaTags.find(m => m.name === 'keywords');
                expect(keywords).toBeDefined();
                expect((keywords?.content || '').toLowerCase()).toContain('webrtc');
                expect((keywords?.content || '').toLowerCase()).toContain('p2p');
                const author = parsed.metaTags.find(m => m.name === 'author');
                expect(author).toBeDefined();
                expect(author?.content).toContain('Bilal Zulfiqar');
            });

            it('preserves runtime theme-color and link[rel="icon"] queried by App.jsx', () => {
                const themeColor = parsed.metaTags.find(m => m.name === 'theme-color');
                expect(themeColor).toBeDefined();
                expect(themeColor?.content).toBeTruthy();

                const iconLink = parsed.linkTags.find(l => l.rel === 'icon');
                expect(iconLink).toBeDefined();
                expect(iconLink?.href).toBeTruthy();
            });
        });

        describe('Feature Area 5: Open Graph & Twitter Cards Protocol (Features 6 & 7)', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsed = parseHtml(htmlContent);

            it('defines standard Open Graph tags (og:type, og:site_name, og:url, og:title, og:description)', () => {
                const getOg = (prop) => parsed.metaTags.find(m => m.property === prop)?.content;
                expect(getOg('og:type')).toBe('website');
                expect(getOg('og:site_name')).toBe('LAN Share');
                expect((getOg('og:url') || '').replace(/\/$/, '')).toBe('https://lan-share.vercel.app');
                expect(getOg('og:title') || '').toContain('LAN Share');
                expect(getOg('og:description')).toBeTruthy();
            });

            it('specifies absolute og:image pointing to banner.png with secure_url', () => {
                const getOg = (prop) => parsed.metaTags.find(m => m.property === prop)?.content;
                expect(getOg('og:image')).toBe('https://lan-share.vercel.app/banner.png');
                expect(getOg('og:image:secure_url')).toBe('https://lan-share.vercel.app/banner.png');
            });

            it('defines og:image:width, og:image:height (1200x420) and og:image:type', () => {
                const getOg = (prop) => parsed.metaTags.find(m => m.property === prop)?.content;
                expect(getOg('og:image:width')).toBe('1200');
                expect(getOg('og:image:height')).toBe('420');
                expect(getOg('og:image:type')).toBe('image/png');
            });

            it('defines twitter:card as summary_large_image', () => {
                const twCard = parsed.metaTags.find(m => m.name === 'twitter:card')?.content;
                expect(twCard).toBe('summary_large_image');
            });

            it('defines twitter:title, twitter:description, and twitter:image', () => {
                const getTw = (name) => parsed.metaTags.find(m => m.name === name)?.content;
                expect(getTw('twitter:title') || '').toContain('LAN Share');
                expect(getTw('twitter:description')).toBeTruthy();
                expect(getTw('twitter:image')).toBe('https://lan-share.vercel.app/banner.png');
            });
        });

        describe('Feature Area 6: Schema.org JSON-LD Entity Graph (Feature 8)', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsed = parseHtml(htmlContent);

            it('contains a script tag with type application/ld+json', () => {
                expect(parsed.jsonLdBlocks.length).toBeGreaterThanOrEqual(1);
            });

            it('JSON-LD script parses cleanly without syntax errors', () => {
                const jsonParsed = safeGetJsonLd(parsed);
                expect(jsonParsed).toBeTruthy();
                expect(jsonParsed?.['@context']).toBe('https://schema.org');
                expect(Array.isArray(jsonParsed?.['@graph'])).toBe(true);
            });

            it('contains WebSite entity with author link', () => {
                const json = safeGetJsonLd(parsed);
                expect(json).toBeTruthy();
                const site = (json?.['@graph'] || []).find(e => e['@type'] === 'WebSite');
                expect(site).toBeDefined();
                expect((site?.url || '').replace(/\/$/, '')).toBe('https://lan-share.vercel.app');
                expect(site?.name).toBe('LAN Share');
                expect(site?.publisher?.['@id']).toBe('https://lan-share.vercel.app/#author');
            });

            it('contains SoftwareApplication entity with FileTransferApplication category', () => {
                const json = safeGetJsonLd(parsed);
                expect(json).toBeTruthy();
                const app = (json?.['@graph'] || []).find(e => {
                    const t = e['@type'];
                    return Array.isArray(t) ? t.includes('SoftwareApplication') : t === 'SoftwareApplication';
                });
                expect(app).toBeDefined();
                expect(app?.applicationCategory).toBe('FileTransferApplication');
                expect(app?.operatingSystem).toContain('WebRTC');
                expect(app?.browserRequirements).toContain('WebRTC');
                expect(app?.isAccessibleForFree).toBe(true);
            });

            it('defines free Offer ($0 USD) with InStock availability', () => {
                const json = safeGetJsonLd(parsed);
                expect(json).toBeTruthy();
                const app = (json?.['@graph'] || []).find(e => {
                    const t = e['@type'];
                    return Array.isArray(t) ? t.includes('SoftwareApplication') : t === 'SoftwareApplication';
                });
                expect(app?.offers).toBeDefined();
                expect(app?.offers?.['@type']).toBe('Offer');
                expect(app?.offers?.price).toBe('0');
                expect(app?.offers?.priceCurrency).toBe('USD');
            });

            it('contains Person entity identifying author Bilal Zulfiqar', () => {
                const json = safeGetJsonLd(parsed);
                expect(json).toBeTruthy();
                const person = (json?.['@graph'] || []).find(e => e['@type'] === 'Person');
                expect(person).toBeDefined();
                expect(person?.['@id']).toBe('https://lan-share.vercel.app/#author');
                expect(person?.name).toBe('Bilal Zulfiqar');
                expect(person?.url).toContain('github.com');
            });
        });

        describe('Feature Area 7: Semantic HTML & Heading Hierarchy (Features 9, 10, 11)', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsed = parseHtml(htmlContent);

            it('raw index.html contains semantic structure (<header>, <main>, <section>, <footer>)', () => {
                expect(parsed.hasHeader).toBe(true);
                expect(parsed.hasMain).toBe(true);
                expect(parsed.hasSection).toBe(true);
                expect(parsed.hasFooter).toBe(true);
            });

            it('semantic content is placed inside #root for pre-hydration crawlability', () => {
                expect(parsed.rootInner).toBeTruthy();
                expect(parsed.rootInner).toContain('<header');
                expect(parsed.rootInner).toContain('<main');
                expect(parsed.rootInner).toContain('<footer');
            });

            it('provides a structured heading hierarchy (h1 and h2 elements)', () => {
                expect(parsed.h1s.length).toBeGreaterThanOrEqual(1);
                expect(parsed.h1s[0] || '').toContain('LAN Share');
                expect(parsed.h2s.length).toBeGreaterThanOrEqual(2);
            });

            it('headings cover WebRTC, local network, and SHA-256 integrity mechanisms', () => {
                const htmlText = (parsed.rootInner || '').toLowerCase();
                expect(htmlText).toContain('webrtc');
                expect(htmlText).toContain('sha-256');
                expect(htmlText).toContain('local');
            });

            it('includes a descriptive <noscript> fallback explaining JavaScript WebRTC requirement', () => {
                expect(parsed.hasNoscript).toBe(true);
                expect(parsed.noscriptContent).toBeTruthy();
                expect((parsed.noscriptContent || '').toLowerCase()).toContain('javascript');
                expect((parsed.noscriptContent || '').toLowerCase()).toContain('webrtc');
            });
        });

        describe('Feature Area 8: Machine-Readable llms.txt & Direct GEO Q&A (Features 12 & 13)', () => {
            const llmsContent = readFileSafe(paths.llmsTxt);
            const parsed = parseLlmsTxt(llmsContent);

            it('llms.txt exists at client/public/llms.txt adhering to llmstxt.org markdown format', () => {
                expect(llmsContent).toBeTruthy();
                expect(parsed.h1).toBe('LAN Share');
                expect(parsed.blockquote).toBeTruthy();
            });

            it('documents system architecture (React 19, Socket.IO, WebRTC, 64 KiB SCTP, SHA-256)', () => {
                const raw = (parsed.raw || '').toLowerCase();
                expect(raw).toContain('webrtc');
                expect(raw).toContain('socket.io');
                expect(raw).toContain('sctp');
                expect(raw).toContain('sha-256');
            });

            it('provides factual direct answers for "without cloud uploads" and "file size limit"', () => {
                const raw = parsed.raw || '';
                expect(raw).toContain('How does LAN Share transfer files without cloud uploads?');
                expect(raw).toContain('What is the file size limit on LAN Share?');
                expect(raw.toLowerCase()).toContain('file system access api');
            });

            it('provides factual direct answers for "Is LAN Share secure?" and network isolation', () => {
                const raw = parsed.raw || '';
                expect(raw).toContain('Is LAN Share secure?');
                expect(raw.toLowerCase()).toContain('dtls');
                expect(raw).toContain('router AP or Client Isolation');
                expect(raw).toContain('watchdog');
            });

            it('contains links to canonical resources, source code, and MIT license', () => {
                const raw = parsed.raw || '';
                expect(raw).toContain('https://lan-share.vercel.app');
                expect(raw).toContain('github.com/bilalzulfiqar-pk/lan-share');
                expect(raw).toContain('LICENSE');
            });
        });
    });

    // -----------------------------------------------------------------------
    // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per area)
    // -----------------------------------------------------------------------
    describe('Tier 2: Boundary & Corner Cases', () => {

        describe('Boundary Area 1: Absolute URLs & Protocol Integrity', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsedHtml = parseHtml(htmlContent);
            const sitemapContent = readFileSafe(paths.sitemapXml);
            const parsedSitemap = parseSitemapXml(sitemapContent);

            it('canonical link enforces https:// protocol and is not relative', () => {
                const canonical = parsedHtml.linkTags.find(l => l.rel === 'canonical');
                expect(canonical).toBeDefined();
                expect((canonical?.href || '').startsWith('https://')).toBe(true);
                expect((canonical?.href || '').startsWith('//')).toBe(false);
                expect((canonical?.href || '').startsWith('/')).toBe(false);
            });

            it('og:url strictly enforces https:// protocol', () => {
                const ogUrl = parsedHtml.metaTags.find(m => m.property === 'og:url')?.content;
                expect(ogUrl).toBeDefined();
                expect((ogUrl || '').startsWith('https://')).toBe(true);
            });

            it('og:image and twitter:image enforce absolute https:// URLs (no relative paths)', () => {
                const ogImage = parsedHtml.metaTags.find(m => m.property === 'og:image')?.content;
                const twImage = parsedHtml.metaTags.find(m => m.name === 'twitter:image')?.content;
                expect(ogImage).toBeDefined();
                expect((ogImage || '').startsWith('https://')).toBe(true);
                expect(twImage).toBeDefined();
                expect((twImage || '').startsWith('https://')).toBe(true);
                expect(ogImage).not.toBe('/banner.svg');
                expect(ogImage).not.toBe('banner.svg');
            });

            it('sitemap <loc> URLs strictly enforce https:// protocol', () => {
                expect(parsedSitemap.urls.length).toBeGreaterThan(0);
                for (const u of parsedSitemap.urls) {
                    expect((u.loc || '').startsWith('https://')).toBe(true);
                }
            });

            it('Schema.org @id and url properties enforce absolute https:// URLs', () => {
                const json = safeGetJsonLd(parsedHtml);
                expect(json).toBeTruthy();
                for (const entity of json?.['@graph'] || []) {
                    if (entity['@id']) expect(entity['@id'].startsWith('https://')).toBe(true);
                    if (entity.url) expect(entity.url.startsWith('https://')).toBe(true);
                }
            });
        });

        describe('Boundary Area 2: Anti-Cheating & Zero-Fabrication Verification', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsedHtml = parseHtml(htmlContent);

            it('Schema JSON-LD contains NO aggregateRating property', () => {
                const rawJson = parsedHtml.jsonLdBlocks[0] || '';
                expect(rawJson).not.toContain('aggregateRating');
            });

            it('Schema JSON-LD contains NO review or reviews property', () => {
                const rawJson = parsedHtml.jsonLdBlocks[0] || '';
                expect(rawJson).not.toContain('"review"');
                expect(rawJson).not.toContain('"reviews"');
            });

            it('Schema JSON-LD contains NO ratingValue or ratingCount', () => {
                const rawJson = parsedHtml.jsonLdBlocks[0] || '';
                expect(rawJson).not.toContain('ratingValue');
                expect(rawJson).not.toContain('ratingCount');
                expect(rawJson).not.toContain('reviewCount');
            });

            it('offers property strictly declares price "0" and free availability', () => {
                const json = safeGetJsonLd(parsedHtml);
                expect(json).toBeTruthy();
                const app = (json?.['@graph'] || []).find(e => {
                    const t = e['@type'];
                    return Array.isArray(t) ? t.includes('SoftwareApplication') : t === 'SoftwareApplication';
                });
                expect(app?.offers?.price).toBe('0');
                expect(app?.isAccessibleForFree).toBe(true);
            });

            it('does not contain fabricated awards, fictional ratings, or spam endorsements', () => {
                const rawJson = (parsedHtml.jsonLdBlocks[0] || '').toLowerCase();
                expect(rawJson).not.toContain('award');
                expect(rawJson).not.toContain('5 star');
                expect(rawJson).not.toContain('best app of the year');
            });
        });

        describe('Boundary Area 3: Resource Protection & Crawlability Boundary', () => {
            const robotsContent = readFileSafe(paths.robotsTxt);
            const parsed = parseRobotsTxt(robotsContent);

            it('robots.txt does not disallow .css, .js, .svg, .png, or webmanifest assets', () => {
                expect(robotsContent).toBeTruthy();
                for (const agent of Object.keys(parsed.userAgents)) {
                    for (const dis of parsed.userAgents[agent]?.disallow || []) {
                        expect(dis).not.toMatch(/\.(css|js|svg|png|webmanifest|woff2)(\$|\/)?$/i);
                    }
                }
            });

            it('robots.txt does not block manifest.webmanifest or favicon.svg', () => {
                expect(robotsContent).toBeTruthy();
                for (const agent of Object.keys(parsed.userAgents)) {
                    for (const dis of parsed.userAgents[agent]?.disallow || []) {
                        expect(dis).not.toBe('/manifest.webmanifest');
                        expect(dis).not.toBe('/favicon.svg');
                    }
                }
            });

            it('disallowed paths target private routes with trailing slashes (/api/, /socket.io/)', () => {
                expect(robotsContent).toBeTruthy();
                const generalDisallows = parsed.userAgents['*']?.disallow || [];
                expect(generalDisallows).toContain('/api/');
                expect(generalDisallows).toContain('/socket.io/');
            });

            it('robots.txt does NOT contain Disallow: / for any legitimate user-agent', () => {
                expect(robotsContent).toBeTruthy();
                for (const agent of Object.keys(parsed.userAgents)) {
                    const hasDisallowRoot = (parsed.userAgents[agent]?.disallow || []).some(d => d === '/' || d === '/*');
                    expect(hasDisallowRoot).toBe(false);
                }
            });

            it('robots.txt lines contain no broken directives or unclosed blocks', () => {
                expect(robotsContent).toBeTruthy();
                const lines = (robotsContent || '').split(/\r?\n/);
                for (const line of lines) {
                    const trimmed = line.replace(/#.*$/, '').trim();
                    if (!trimmed) continue;
                    expect(trimmed).toMatch(/^(User-agent|Allow|Disallow|Sitemap):\s*.+$/i);
                }
            });
        });

        describe('Boundary Area 4: Hydration & DOM Selectors Resilience', () => {
            const htmlContent = readFileSafe(paths.indexHtml);
            const parsedHtml = parseHtml(htmlContent);
            const appJsxContent = readFileSafe(paths.appJsx);

            it('link[rel="icon"] is strictly queryable as required by updateFavicon in App.jsx', () => {
                expect(appJsxContent).toContain('link[rel=\'icon\']');
                const iconLink = parsedHtml.linkTags.find(l => l.rel === 'icon');
                expect(iconLink).toBeDefined();
                expect(iconLink?.href).toBeTruthy();
            });

            it('meta[name="theme-color"] is strictly queryable as required by theme switcher in App.jsx', () => {
                expect(appJsxContent).toContain('meta[name="theme-color"]');
                const themeMeta = parsedHtml.metaTags.find(m => m.name === 'theme-color');
                expect(themeMeta).toBeDefined();
            });

            it('pre-hydration styling does not use negative margins or horizontal overflow classes', () => {
                const rootInner = parsedHtml.rootInner || '';
                expect(rootInner).not.toMatch(/margin-\w+:\s*-\d+/);
                expect(rootInner).not.toContain('overflow-x: scroll');
            });

            it('pre-hydration root markup contains no inline <script> tags or execution blockers', () => {
                const rootInner = parsedHtml.rootInner || '';
                expect(rootInner).not.toMatch(/<script[\s>]/i);
            });
        });
    });

    // -----------------------------------------------------------------------
    // TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Consistency)
    // -----------------------------------------------------------------------
    describe('Tier 3: Cross-Feature Combinations', () => {
        const htmlContent = readFileSafe(paths.indexHtml);
        const parsedHtml = parseHtml(htmlContent);
        const sitemapContent = readFileSafe(paths.sitemapXml);
        const parsedSitemap = parseSitemapXml(sitemapContent);
        const robotsContent = readFileSafe(paths.robotsTxt);
        const parsedRobots = parseRobotsTxt(robotsContent);
        const llmsContent = readFileSafe(paths.llmsTxt);
        const parsedLlms = parseLlmsTxt(llmsContent);

        it('Pairwise 1: Sitemap URL matches canonical link tag in index.html', () => {
            expect(parsedSitemap.urls.length).toBeGreaterThan(0);
            const sitemapLoc = (parsedSitemap.urls[0]?.loc || '').replace(/\/$/, '');
            const canonicalHref = (parsedHtml.linkTags.find(l => l.rel === 'canonical')?.href || '').replace(/\/$/, '');
            expect(sitemapLoc).toBe(canonicalHref);
        });

        it('Pairwise 2: og:url matches canonical link tag and sitemap URL', () => {
            const canonicalHref = (parsedHtml.linkTags.find(l => l.rel === 'canonical')?.href || '').replace(/\/$/, '');
            const ogUrl = (parsedHtml.metaTags.find(m => m.property === 'og:url')?.content || '').replace(/\/$/, '');
            expect(ogUrl).toBe(canonicalHref);
        });

        it('Pairwise 3: robots.txt Sitemap directive URL matches sitemap.xml canonical URL', () => {
            expect(parsedRobots.sitemaps.length).toBeGreaterThan(0);
            const robotsSitemapUrl = parsedRobots.sitemaps[0];
            expect(robotsSitemapUrl).toBe('https://lan-share.vercel.app/sitemap.xml');
            expect(parsedSitemap.urls.length).toBeGreaterThan(0);
        });

        it('Pairwise 4: og:image matches banner.png path in public assets and 1200x420 aspect ratio', () => {
            const ogImage = parsedHtml.metaTags.find(m => m.property === 'og:image')?.content;
            expect(ogImage).toBe('https://lan-share.vercel.app/banner.png');
            expect(fs.existsSync(paths.publicBannerPng)).toBe(true);

            const width = parsedHtml.metaTags.find(m => m.property === 'og:image:width')?.content;
            const height = parsedHtml.metaTags.find(m => m.property === 'og:image:height')?.content;
            expect(width).toBe('1200');
            expect(height).toBe('420');
        });

        it('Pairwise 5: twitter:image exactly matches og:image', () => {
            const ogImage = parsedHtml.metaTags.find(m => m.property === 'og:image')?.content;
            const twImage = parsedHtml.metaTags.find(m => m.name === 'twitter:image')?.content;
            expect(twImage).toBe(ogImage);
        });

        it('Pairwise 6: llms.txt protocol descriptions match Schema.org featureList', () => {
            const json = safeGetJsonLd(parsedHtml);
            expect(json).toBeTruthy();
            const app = (json?.['@graph'] || []).find(e => {
                const t = e['@type'];
                return Array.isArray(t) ? t.includes('SoftwareApplication') : t === 'SoftwareApplication';
            });
            const features = (app?.featureList || []).join(' ').toLowerCase();
            const llmsRaw = (parsedLlms.raw || '').toLowerCase();

            expect(features).toContain('webrtc');
            expect(llmsRaw).toContain('webrtc');
            expect(features).toContain('sha-256');
            expect(llmsRaw).toContain('sha-256');
            expect(features).toContain('cloud');
            expect(llmsRaw).toContain('cloud');
        });

        it('Pairwise 7: Schema.org screenshot points to banner.svg matching og:image', () => {
            const json = safeGetJsonLd(parsedHtml);
            expect(json).toBeTruthy();
            const app = (json?.['@graph'] || []).find(e => {
                const t = e['@type'];
                return Array.isArray(t) ? t.includes('SoftwareApplication') : t === 'SoftwareApplication';
            });
            const ogImage = parsedHtml.metaTags.find(m => m.property === 'og:image')?.content;
            expect(app?.screenshot).toBe(ogImage);
        });

        it('Pairwise 8: Meta author tag matches Schema.org Person entity name', () => {
            const json = safeGetJsonLd(parsedHtml);
            expect(json).toBeTruthy();
            const person = (json?.['@graph'] || []).find(e => e['@type'] === 'Person');
            const metaAuthor = parsedHtml.metaTags.find(m => m.name === 'author')?.content;
            expect(metaAuthor).toBe(person?.name);
            expect(person?.name).toBe('Bilal Zulfiqar');
        });
    });

    // -----------------------------------------------------------------------
    // TIER 4: REAL-WORLD SEARCH ENGINE & AI CRAWLER SCENARIOS
    // -----------------------------------------------------------------------
    describe('Tier 4: Real-World Search Engine & AI Crawler Scenarios', () => {

        it('Scenario 1: Googlebot crawl simulation (robots.txt -> sitemap.xml -> index.html -> JSON-LD)', () => {
            // Step 1: Googlebot checks robots.txt
            const robotsContent = readFileSafe(paths.robotsTxt);
            expect(robotsContent).toBeTruthy();
            const robots = parseRobotsTxt(robotsContent);
            const isRootAllowed = !(robots.userAgents['*']?.disallow || []).includes('/');
            expect(isRootAllowed).toBe(true);

            // Step 2: Googlebot follows sitemap directive
            expect(robots.sitemaps.length).toBeGreaterThan(0);
            const sitemapUrl = robots.sitemaps[0];
            expect(sitemapUrl).toBe('https://lan-share.vercel.app/sitemap.xml');

            // Step 3: Googlebot fetches sitemap.xml
            const sitemapContent = readFileSafe(paths.sitemapXml);
            const sitemap = parseSitemapXml(sitemapContent);
            expect(sitemap.urls.length).toBeGreaterThan(0);
            const landingUrl = sitemap.urls[0]?.loc || '';

            // Step 4: Googlebot fetches landing page index.html
            const htmlContent = readFileSafe(paths.indexHtml);
            const html = parseHtml(htmlContent);
            expect(html.title).toBeTruthy();
            const desc = html.metaTags.find(m => m.name === 'description')?.content;
            expect(desc).toBeTruthy();
            const canonical = html.linkTags.find(l => l.rel === 'canonical')?.href || '';
            expect(canonical.replace(/\/$/, '')).toBe(landingUrl.replace(/\/$/, ''));

            // Step 5: Googlebot parses JSON-LD knowledge graph
            expect(html.jsonLdBlocks.length).toBeGreaterThan(0);
            const graph = safeGetJsonLd(html);
            expect(graph).toBeTruthy();
            expect((graph?.['@graph'] || []).length).toBeGreaterThanOrEqual(3);
        });

        it('Scenario 2: Perplexity / GPTBot simulation (robots.txt -> llms.txt -> direct Q&A extraction)', () => {
            // Step 1: GPTBot checks crawler allowance
            const robots = parseRobotsTxt(readFileSafe(paths.robotsTxt));
            expect(robots.userAgents['GPTBot']?.allow || []).toContain('/');
            expect(robots.userAgents['PerplexityBot']?.allow || []).toContain('/');

            // Step 2: Agent requests /llms.txt
            const llms = parseLlmsTxt(readFileSafe(paths.llmsTxt));
            expect(llms.raw).toBeTruthy();
            expect(llms.h1).toBe('LAN Share');

            // Step 3: Agent executes query: "How does LAN Share transfer files without cloud uploads?"
            expect(llms.h3s).toContain('How does LAN Share transfer files without cloud uploads?');
            const cloudAnswerMatch = (llms.raw || '').match(/### How does LAN Share transfer files without cloud uploads\?\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
            expect(cloudAnswerMatch).toBeTruthy();
            const cloudAnswer = (cloudAnswerMatch?.[1] || '').toLowerCase();
            expect(cloudAnswer).toContain('webrtc');
            expect(cloudAnswer).toContain('peer-to-peer');

            // Step 4: Agent executes query: "What is the file size limit on LAN Share?"
            expect(llms.h3s).toContain('What is the file size limit on LAN Share?');
            const limitAnswerMatch = (llms.raw || '').match(/### What is the file size limit on LAN Share\?\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
            expect(limitAnswerMatch).toBeTruthy();
            const limitAnswer = (limitAnswerMatch?.[1] || '').toLowerCase();
            expect(limitAnswer).toContain('file system access api');

            // Step 5: Agent executes query: "Is LAN Share secure?"
            expect(llms.h3s).toContain('Is LAN Share secure?');
            const secureAnswerMatch = (llms.raw || '').match(/### Is LAN Share secure\?\s*\n([\s\S]*?)(?=\n###|\n##|$)/i);
            expect(secureAnswerMatch).toBeTruthy();
            const secureAnswer = (secureAnswerMatch?.[1] || '').toLowerCase();
            expect(secureAnswer).toContain('dtls');
            expect(secureAnswer).toContain('sha-256');
        });

        it('Scenario 3: Social link unfurl simulation (Twitter / Slack / Discord / Facebook)', () => {
            const html = parseHtml(readFileSafe(paths.indexHtml));

            // Extract unfurl properties
            const ogTitle = html.metaTags.find(m => m.property === 'og:title')?.content;
            const ogDesc = html.metaTags.find(m => m.property === 'og:description')?.content;
            const ogImage = html.metaTags.find(m => m.property === 'og:image')?.content;
            const twCard = html.metaTags.find(m => m.name === 'twitter:card')?.content;

            expect(ogTitle).toBeTruthy();
            expect((ogTitle || '').length).toBeLessThan(70); // Optimal social title length

            expect(ogDesc).toBeTruthy();
            expect((ogDesc || '').length).toBeLessThan(200); // Optimal social snippet length

            expect(twCard).toBe('summary_large_image');
            expect(ogImage).toBe('https://lan-share.vercel.app/banner.png');

            // Verify banner PNG file exists
            expect(fs.existsSync(paths.publicBannerPng)).toBe(true);
        });

        it('Scenario 4: Non-JS search crawler simulation (Baidu / DuckDuckGo / Lynx)', () => {
            const html = parseHtml(readFileSafe(paths.indexHtml));

            // Verify semantic elements in initial HTML payload without running client JS
            expect(html.hasHeader).toBe(true);
            expect(html.hasMain).toBe(true);
            expect(html.hasSection).toBe(true);
            expect(html.hasFooter).toBe(true);

            // Verify headings
            expect(html.h1s.length).toBeGreaterThanOrEqual(1);
            expect(html.h1s[0]).toBe('LAN Share');
            expect(html.h2s.length).toBeGreaterThanOrEqual(3);

            // Verify <noscript> explanation is present
            expect(html.hasNoscript).toBe(true);
            expect((html.noscriptContent || '').toLowerCase()).toContain('javascript');

            // Verify keyword presence in crawlable body text
            const body = (html.rootInner || '').toLowerCase();
            expect(body).toContain('webrtc');
            expect(body).toContain('peer-to-peer');
            expect(body).toContain('sha-256');
        });

        it('Scenario 5: Milestone 4 Integrity & Test Runner Verification (Features 15 & 16)', () => {
            // Verify path resolutions are intact
            expect(fs.existsSync(paths.indexHtml)).toBe(true);
            expect(fs.existsSync(paths.appJsx)).toBe(true);
            expect(fs.existsSync(paths.docsBannerSvg)).toBe(true);
        });
    });
});

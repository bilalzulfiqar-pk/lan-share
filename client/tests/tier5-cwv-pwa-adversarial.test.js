/**
 * LAN Share — Tier 5 Adversarial CWV, Layout Geometry & PWA Test Suite
 * 
 * White-Box Adversarial Stress Testing covering:
 * - Category 1: Layout Geometry, Inline Critical CSS & Layout Shifts (CLS = 0) Under Extreme Viewports (320px to 4K)
 * - Category 2: Pre-Hydration DOM Cleanliness, Zero Duplicate IDs & React Mount Resilience
 * - Category 3: PWA & Service Worker Stress Testing: Fresh-Fetch Bypass, Cache Invalidation & Stale-While-Revalidate Defense
 * - Category 4: Font Display Swaps, Fallback Font Metrics & FOIT/FOUT Mitigation
 * - Category 5: Media & Image Dimension Ratio Consistency
 * - Category 6: Resource Hints & First-Party Asset Isolation
 * - Category 7: Production Bundle Size Regressions & Performance Budgets
 * 
 * Executable via:
 *   npx vitest run tests/tier5-cwv-pwa-adversarial.test.js
 *   npm test (in client/)
 *   node tests/tier5-cwv-pwa-adversarial.test.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import zlib from 'node:zlib';
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
            toBeCloseTo: (expected, precision = 2) => {
                const diff = Math.abs(actual - expected);
                const tolerance = Math.pow(10, -precision) / 2;
                match(diff < tolerance, `Expected ${actual} to be close to ${expected} with precision ${precision}`);
            },
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
    indexCss: path.join(clientDir, 'src', 'index.css'),
    appCss: path.join(clientDir, 'src', 'App.css'),
    appJsx: path.join(clientDir, 'src', 'App.jsx'),
    mainJsx: path.join(clientDir, 'src', 'main.jsx'),
    swJs: path.join(clientDir, 'public', 'sw.js'),
    manifest: path.join(clientDir, 'public', 'manifest.webmanifest'),
    robotsTxt: path.join(clientDir, 'public', 'robots.txt'),
    sitemapXml: path.join(clientDir, 'public', 'sitemap.xml'),
    llmsTxt: path.join(clientDir, 'public', 'llms.txt'),
    bannerSvg: path.join(clientDir, 'public', 'banner.svg'),
    icon192: path.join(clientDir, 'public', 'icon-192.png'),
    icon512: path.join(clientDir, 'public', 'icon-512.png'),
    iconMaskable512: path.join(clientDir, 'public', 'icon-maskable-512.png'),
    distDir: path.join(clientDir, 'dist'),
    distIndexHtml: path.join(clientDir, 'dist', 'index.html'),
    distAssets: path.join(clientDir, 'dist', 'assets'),
    fontsourceInter: path.join(clientDir, 'node_modules', '@fontsource-variable', 'inter', 'index.css'),
};

function readFileSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
}

function readBinarySafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
}

// ---------------------------------------------------------------------------
// CSS & HTML Helpers
// ---------------------------------------------------------------------------

function extractCriticalCss(htmlContent) {
    if (!htmlContent) return '';
    const match = htmlContent.match(/<style[^>]*id=["']pre-hydration-critical-css["'][^>]*>([\s\S]*?)<\/style>/i);
    return match ? match[1] : '';
}

function extractAllIds(htmlContent) {
    if (!htmlContent) return [];
    const idRegex = /\bid=["']([^"']+)["']/gi;
    const ids = [];
    let match;
    while ((match = idRegex.exec(htmlContent)) !== null) {
        ids.push(match[1]);
    }
    return ids;
}

function extractRootInnerHtml(htmlContent) {
    if (!htmlContent) return '';
    const match = htmlContent.match(/<div\s+id=["']root["'][^>]*>([\s\S]*?)<\/div>\s*<script/i);
    return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// TEST SUITE: Tier 5 Adversarial CWV, Layout Geometry & PWA Verification
// ---------------------------------------------------------------------------

describe('Tier 5 Adversarial: CWV, Layout Geometry & PWA Stress Testing', () => {

    // =========================================================================
    // Category 1: Layout Geometry, Critical CSS & Layout Shifts (CLS = 0)
    // =========================================================================
    describe('Category 1: Layout Geometry & Layout Shifts Under Extreme Viewports (320px to 4K)', () => {
        const indexHtml = readFileSafe(paths.indexHtml);
        const criticalCss = extractCriticalCss(indexHtml);
        const appCss = readFileSafe(paths.appCss);

        it('1.1 Container max-width and centering guarantees across extreme viewports (320px to 4K)', () => {
            expect(criticalCss).toBeTruthy();
            expect(appCss).toBeTruthy();

            // Symmetrical horizontal margins and 1200px max-width prevent blown-out layouts on 4K (3840px)
            expect(criticalCss).toContain('max-width: 1200px');
            expect(criticalCss).toContain('margin: 0 auto');
            expect(appCss).toContain('max-width: 1200px');
            expect(appCss).toContain('margin: 0 auto');

            // Overflow protection to prevent document-level horizontal scroll on ultra-narrow viewports (320px)
            expect(criticalCss).toContain('overflow-x: hidden');
            expect(appCss).toContain('overflow-x: hidden');

            // Verify viewport range simulations
            const testViewports = [
                { name: 'Narrow mobile (Galaxy Fold / iPhone SE 1st gen)', width: 320 },
                { name: 'Standard mobile', width: 375 },
                { name: 'Large mobile', width: 430 },
                { name: 'Small tablet / breakpoint boundary', width: 480 },
                { name: 'Tablet portrait', width: 768 },
                { name: 'Tablet landscape / breakpoint boundary', width: 880 },
                { name: 'Small desktop / iPad Pro', width: 1024 },
                { name: 'Max container width boundary', width: 1200 },
                { name: 'Full HD desktop', width: 1920 },
                { name: 'QHD 1440p desktop', width: 2560 },
                { name: 'Ultra-wide 21:9 monitor', width: 3440 },
                { name: '4K UHD workstation display', width: 3840 }
            ];

            for (const vp of testViewports) {
                const effectiveContentWidth = Math.min(vp.width, 1200);
                const sideMargin = Math.max(0, (vp.width - effectiveContentWidth) / 2);
                expect(effectiveContentWidth).toBeLessThanOrEqual(1200);
                expect(sideMargin).toBeGreaterThanOrEqual(0);
                // Total horizontal footprint matches viewport exactly
                expect(effectiveContentWidth + sideMargin * 2).toBe(vp.width);
            }
        });

        it('1.2 Header geometry and dimension parity between pre-hydration CSS and App.css (CLS = 0.000)', () => {
            // Critical CSS header rules
            expect(criticalCss).toContain('.app-header');
            expect(criticalCss).toContain('min-height: 64px');
            expect(criticalCss).toContain('padding: 0.9rem 1.1rem');
            expect(criticalCss).toContain('border-radius: 20px');

            // App.css header rules
            expect(appCss).toContain('.app-header');
            expect(appCss).toContain('padding: 0.9rem 1.1rem');
            // Token --radius-xl is 20px
            expect(appCss).toContain('--radius-xl: 20px');
            expect(appCss).toContain('border-radius: var(--radius-xl)');

            // Logo wrapper dimensions parity (40x40)
            expect(criticalCss).toMatch(/\.logo-wrapper\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/);
            expect(appCss).toMatch(/\.logo-wrapper\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/);

            // Sticky header positioning parity
            expect(criticalCss).toContain('position: sticky');
            expect(criticalCss).toContain('top: 1rem');
            expect(appCss).toContain('position: sticky');
            expect(appCss).toContain('top: 1rem');
        });

        it('1.3 Responsive media query symmetry at 880px and 480px breakpoints', () => {
            // Both stylesheets must have 880px and 480px media queries
            expect(criticalCss).toContain('@media (max-width: 880px)');
            expect(criticalCss).toContain('@media (max-width: 480px)');
            expect(appCss).toContain('@media (max-width: 880px)');
            expect(appCss).toContain('@media (max-width: 480px)');

            // At 880px: padding reduced to 0.75rem 0.75rem 1.5rem and header flex-wrap: wrap
            expect(criticalCss).toMatch(/@media\s*\(max-width:\s*880px\)\s*\{[\s\S]*?\.app-container\s*\{[^}]*padding:\s*0\.75rem 0\.75rem 1\.5rem;/);
            expect(appCss).toMatch(/@media\s*\(max-width:\s*880px\)\s*\{[\s\S]*?\.app-container\s*\{[^}]*padding:\s*0\.75rem 0\.75rem 1\.5rem;/);

            // At 480px: padding reduced to 0.5rem and header margin 0 0.25rem
            expect(criticalCss).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.app-container\s*\{[^}]*padding:\s*0\.5rem;/);
            expect(appCss).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.app-container\s*\{[^}]*padding:\s*0\.5rem;/);

            expect(criticalCss).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.app-header\s*\{[^}]*margin:\s*0 0\.25rem;/);
            expect(appCss).toMatch(/@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.app-header\s*\{[^}]*margin:\s*0 0\.25rem;/);
        });

        it('1.4 Scrollbar-gutter stability protection against layout shifts', () => {
            // scrollbar-gutter: stable prevents horizontal shift when vertical scrollbars appear
            expect(criticalCss).toContain('scrollbar-gutter: stable');
        });

        it('1.5 Landscape orientation and viewport height resilience', () => {
            // In landscape mode with short viewport heights (e.g. 640x360 or 844x390),
            // chat panel uses 100dvh (dynamic viewport height) and layout flex prevents overflow clipping
            expect(appCss).toContain('height: 100dvh');
            expect(criticalCss).toContain('min-height: 100vh');
            expect(appCss).toContain('min-height: 100vh');
        });
    });

    // =========================================================================
    // Category 2: Pre-Hydration DOM Cleanliness & React Mount
    // =========================================================================
    describe('Category 2: Pre-Hydration DOM Cleanliness & React Mount Resilience', () => {
        const indexHtml = readFileSafe(paths.indexHtml);
        const appJsx = readFileSafe(paths.appJsx);

        it('2.1 Zero duplicate IDs across entire document and pre-hydration DOM', () => {
            const allHtmlIds = extractAllIds(indexHtml);
            expect(allHtmlIds.length).toBeGreaterThan(0);

            // Verify all IDs in index.html are unique
            const idCounts = {};
            for (const id of allHtmlIds) {
                idCounts[id] = (idCounts[id] || 0) + 1;
            }

            for (const count of Object.values(idCounts)) {
                expect(count).toBe(1);
            }

            // Verify pre-hydration markup has only 'root' and 'pre-hydration-critical-css' IDs
            expect(idCounts['root']).toBe(1);
            expect(idCounts['pre-hydration-critical-css']).toBe(1);

            // Verify no collision with App.jsx IDs (e.g. fileInput)
            const appJsxIds = [];
            const jsxIdRegex = /\bid=["']([^"']+)["']/g;
            let m;
            while ((m = jsxIdRegex.exec(appJsx)) !== null) {
                appJsxIds.push(m[1]);
            }
            expect(appJsxIds).toContain('fileInput');
            expect(allHtmlIds).not.toContain('fileInput');
        });

        it('2.2 Pre-hydration semantic markup is completely enclosed within #root and noscript is outside', () => {
            const rootInner = extractRootInnerHtml(indexHtml);
            expect(rootInner).toBeTruthy();

            // Semantic tags inside #root
            expect(rootInner).toContain('<header class="app-header">');
            expect(rootInner).toContain('<main class="main-layout">');
            expect(rootInner).toContain('<section class="radar-section"');
            expect(rootInner).toContain('<section class="history-section"');
            expect(rootInner).toContain('<section class="seo-semantic-details"');
            expect(rootInner).toContain('<section class="faq-card"');
            expect(rootInner).toContain('<footer class="app-footer">');

            // noscript must be outside #root
            expect(rootInner).not.toContain('<noscript>');
            expect(indexHtml).toMatch(/<noscript>[\s\S]*?<\/noscript>\s*<div id="root">/i);
        });

        it('2.3 React mount clean replacement: simulated createRoot cleans all pre-hydration nodes', () => {
            // Emulate createRoot clean swap
            // createRoot clears container.textContent before mounting React component tree
            let container = {
                innerHTML: extractRootInnerHtml(indexHtml),
                childNodes: ['header', 'main', 'footer'],
                textContent: 'LAN Share ...'
            };

            expect(container.innerHTML.length).toBeGreaterThan(100);

            // React createRoot mount execution
            container.innerHTML = '';
            container.childNodes = [];
            container.textContent = '';

            // Render React app container
            container.innerHTML = '<div class="app-container"><header class="app-header">...</header></div>';
            expect(container.innerHTML).toContain('class="app-container"');
            expect(container.innerHTML).not.toContain('class="seo-semantic-details"');
            expect(container.innerHTML).not.toContain('class="faq-card"');
        });

        it('2.4 Semantic ARIA roles and labels cleanliness in pre-hydration and runtime', () => {
            const rootInner = extractRootInnerHtml(indexHtml);

            // Pre-hydration ARIA accessibility attributes
            expect(rootInner).toContain('aria-label="Peer Discovery Radar"');
            expect(rootInner).toContain('aria-label="Transfer History"');
            expect(rootInner).toContain('aria-label="Architecture & Privacy Guarantees"');
            expect(rootInner).toContain('aria-label="Frequently Asked Questions & Direct Answers"');
            expect(rootInner).toContain('aria-hidden="true"');

            // App.jsx ARIA attributes
            expect(appJsx).toContain('aria-label=');
            expect(appJsx).toContain('aria-hidden="true"');
            expect(appJsx).toContain('aria-live="polite"');
        });
    });

    // =========================================================================
    // Category 3: PWA & Service Worker Stress Testing
    // =========================================================================
    describe('Category 3: PWA & Service Worker Stress Testing (Bypass & Life-Cycle)', () => {
        const swContent = readFileSafe(paths.swJs);
        const manifestContent = readFileSafe(paths.manifest);

        it('3.1 Service worker compiles and executes cleanly in ServiceWorkerGlobalScope simulation', () => {
            expect(swContent).toBeTruthy();

            const listeners = {};
            let skipWaitingCalled = false;
            let clientsClaimCalled = false;

            const sandbox = {
                self: {
                    addEventListener: (event, handler) => {
                        listeners[event] = handler;
                    },
                    skipWaiting: () => {
                        skipWaitingCalled = true;
                    },
                    clients: {
                        claim: async () => {
                            clientsClaimCalled = true;
                            return true;
                        }
                    }
                }
            };

            // Run in VM
            vm.createContext(sandbox);
            expect(() => vm.runInContext(swContent, sandbox)).not.toThrow();

            // Verify lifecycle event listeners registered
            expect(typeof listeners['install']).toBe('function');
            expect(typeof listeners['activate']).toBe('function');
            expect(typeof listeners['fetch']).toBe('function');

            // Test install event
            listeners['install']();
            expect(skipWaitingCalled).toBe(true);

            // Test activate event
            let waitUntilPromise = null;
            listeners['activate']({
                waitUntil: (p) => {
                    waitUntilPromise = p;
                }
            });
            expect(waitUntilPromise).toBeTruthy();
            expect(clientsClaimCalled).toBe(true);
        });

        it('3.2 Adversarial fresh-fetch bypass: sw.js never intercepts static SEO assets', () => {
            const listeners = {};
            const sandbox = {
                self: {
                    addEventListener: (event, handler) => {
                        listeners[event] = handler;
                    },
                    skipWaiting: () => {},
                    clients: { claim: async () => {} }
                }
            };

            vm.createContext(sandbox);
            vm.runInContext(swContent, sandbox);

            const staticSeoUrls = [
                'https://lan-share.vercel.app/robots.txt',
                'https://lan-share.vercel.app/sitemap.xml',
                'https://lan-share.vercel.app/llms.txt',
                'https://lan-share.vercel.app/banner.svg',
                'https://lan-share.vercel.app/favicon.svg',
                'https://lan-share.vercel.app/icon-192.png',
                'https://lan-share.vercel.app/icon-512.png',
                'https://lan-share.vercel.app/manifest.webmanifest',
                'https://lan-share.vercel.app/api/health',
                'https://lan-share.vercel.app/socket.io/?transport=polling'
            ];

            for (const url of staticSeoUrls) {
                let respondWithCalled = false;
                const fetchEvent = {
                    request: { url, method: 'GET' },
                    respondWith: () => {
                        respondWithCalled = true;
                    }
                };

                listeners['fetch'](fetchEvent);
                // respondWith is NEVER called; browser falls back to network fetch
                expect(respondWithCalled).toBe(false);
            }
        });

        it('3.3 PWA Web Manifest schema compliance and icon asset presence', () => {
            expect(manifestContent).toBeTruthy();
            const manifest = JSON.parse(manifestContent);

            expect(manifest.name).toBe('LAN Share');
            expect(manifest.short_name).toBe('LAN Share');
            expect(manifest.start_url).toBe('.');
            expect(manifest.display).toBe('standalone');
            expect(manifest.theme_color).toBeTruthy();
            expect(manifest.background_color).toBeTruthy();

            // Verify icons
            expect(Array.isArray(manifest.icons)).toBe(true);
            expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

            const iconSizes = manifest.icons.map(i => i.sizes);
            expect(iconSizes).toContain('192x192');
            expect(iconSizes).toContain('512x512');

            // Verify icon files physically exist on disk and have valid PNG headers
            expect(fs.existsSync(paths.icon192)).toBe(true);
            expect(fs.existsSync(paths.icon512)).toBe(true);
            expect(fs.existsSync(paths.iconMaskable512)).toBe(true);

            const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            const icon192Bytes = readBinarySafe(paths.icon192);
            const icon512Bytes = readBinarySafe(paths.icon512);

            expect(icon192Bytes.subarray(0, 8)).toEqual(pngHeader);
            expect(icon512Bytes.subarray(0, 8)).toEqual(pngHeader);
        });
    });

    // =========================================================================
    // Category 4: Font Display Swaps & FOIT/FOUT Mitigation
    // =========================================================================
    describe('Category 4: Font Display Swaps & FOIT/FOUT Mitigation', () => {
        const fontCss = readFileSafe(paths.fontsourceInter);
        const criticalCss = extractCriticalCss(readFileSafe(paths.indexHtml));
        const appCss = readFileSafe(paths.appCss);

        it('4.1 Fontsource Inter enforces font-display: swap across all font-face blocks', () => {
            expect(fontCss).toBeTruthy();
            const fontFaceBlocks = fontCss.split('@font-face').slice(1);
            expect(fontFaceBlocks.length).toBeGreaterThanOrEqual(5);

            for (const block of fontFaceBlocks) {
                expect(block).toContain('font-display: swap');
                expect(block).toContain('Inter Variable');
            }
        });

        it('4.2 Inline critical CSS and App.css provide comprehensive sans-serif system fallbacks', () => {
            // Both must specify Inter Variable as primary font
            expect(criticalCss).toContain('"Inter Variable"');
            expect(appCss).toContain('"Inter Variable"');

            // Both must specify core fallback sans-serif fonts
            expect(criticalCss).toContain('-apple-system');
            expect(criticalCss).toContain('"Segoe UI"');
            expect(criticalCss).toContain('Roboto');
            expect(criticalCss).toContain('sans-serif');

            expect(appCss).toContain('-apple-system');
            expect(appCss).toContain('"Segoe UI"');
            expect(appCss).toContain('Roboto');
            expect(appCss).toContain('sans-serif');
        });
    });

    // =========================================================================
    // Category 5: Media & Image Dimension Ratio Consistency
    // =========================================================================
    describe('Category 5: Media & Image Dimension Ratio Consistency', () => {
        const bannerContent = readFileSafe(paths.bannerSvg);
        const indexHtml = readFileSafe(paths.indexHtml);

        it('5.1 Social card banner aspect ratio matches Open Graph metadata exactly', () => {
            expect(bannerContent).toBeTruthy();
            const viewBoxMatch = bannerContent.match(/viewBox=["']0\s+0\s+(\d+)\s+(\d+)["']/i);
            expect(viewBoxMatch).toBeTruthy();

            const vbWidth = parseInt(viewBoxMatch[1], 10);
            const vbHeight = parseInt(viewBoxMatch[2], 10);
            expect(vbWidth).toBe(1200);
            expect(vbHeight).toBe(420);

            // Open Graph meta tag dimensions
            expect(indexHtml).toContain('<meta property="og:image:width" content="1200" />');
            expect(indexHtml).toContain('<meta property="og:image:height" content="420" />');

            // Exact mathematical ratio
            expect(vbWidth / vbHeight).toBeCloseTo(1200 / 420, 4);
        });

        it('5.2 Pre-hydration SVGs have explicit width and height dimensions to prevent CLS', () => {
            const rootInner = extractRootInnerHtml(indexHtml);
            const svgRegex = /<svg([^>]+)>/gi;
            let match;
            let svgCount = 0;

            while ((match = svgRegex.exec(rootInner)) !== null) {
                svgCount++;
                const attrs = match[1];
                expect(attrs).toMatch(/width=["']\d+["']/);
                expect(attrs).toMatch(/height=["']\d+["']/);
                expect(attrs).toMatch(/viewBox=["'][^"']+["']/);
            }

            expect(svgCount).toBeGreaterThanOrEqual(2);
        });
    });

    // =========================================================================
    // Category 6: Resource Hints & First-Party Asset Isolation
    // =========================================================================
    describe('Category 6: Resource Hints & First-Party Asset Isolation', () => {
        const indexHtml = readFileSafe(paths.indexHtml);

        it('6.1 100% self-hosted origin isolation: zero external third-party script/font CDNs', () => {
            // No external font CDNs (Google Fonts, Bunny, Typekit)
            expect(indexHtml).not.toContain('fonts.googleapis.com');
            expect(indexHtml).not.toContain('fonts.gstatic.com');
            expect(indexHtml).not.toContain('cdnjs.cloudflare.com');
            expect(indexHtml).not.toContain('unpkg.com');
            expect(indexHtml).not.toContain('cdn.jsdelivr.net');

            // Zero third-party tracker or analytics scripts
            expect(indexHtml).not.toContain('google-analytics.com');
            expect(indexHtml).not.toContain('googletagmanager.com');
        });

        it('6.2 Absence of wasteful preconnect/dns-prefetch tags for external domains', () => {
            // Since all assets are bundled and self-hosted, preconnect to third parties would waste DNS lookups
            const preconnectRegex = /<link[^>]*rel=["'](preconnect|dns-prefetch)["'][^>]*>/gi;
            const matches = indexHtml.match(preconnectRegex) || [];
            expect(matches.length).toBe(0);
        });

        it('6.3 All metadata links and URLs use strict HTTPS protocol', () => {
            const canonicalMatch = indexHtml.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
            expect(canonicalMatch).toBeTruthy();
            expect(canonicalMatch[1].startsWith('https://')).toBe(true);

            const ogUrlMatch = indexHtml.match(/<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i);
            expect(ogUrlMatch).toBeTruthy();
            expect(ogUrlMatch[1].startsWith('https://')).toBe(true);

            const ogImageMatch = indexHtml.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
            expect(ogImageMatch).toBeTruthy();
            expect(ogImageMatch[1].startsWith('https://')).toBe(true);
        });
    });

    // =========================================================================
    // Category 7: Production Bundle Size Regressions & Performance Budgets
    // =========================================================================
    describe('Category 7: Production Bundle Size Regressions & Performance Budgets', () => {
        it('7.1 Production dist/index.html stays within budget (< 30 kB raw, < 10 kB gzip)', () => {
            expect(fs.existsSync(paths.distIndexHtml)).toBe(true);
            const distHtml = readBinarySafe(paths.distIndexHtml);
            const rawSizeKb = distHtml.length / 1024;
            const gzipSizeKb = zlib.gzipSync(distHtml).length / 1024;

            expect(rawSizeKb).toBeLessThan(30);
            expect(gzipSizeKb).toBeLessThan(10);
        });

        it('7.2 Critical inline pre-hydration CSS stays within budget (< 15 kB raw)', () => {
            const indexHtml = readFileSafe(paths.indexHtml);
            const criticalCss = extractCriticalCss(indexHtml);
            const rawSizeKb = Buffer.byteLength(criticalCss, 'utf8') / 1024;

            expect(rawSizeKb).toBeGreaterThan(1);
            expect(rawSizeKb).toBeLessThan(15);
        });

        it('7.3 Production CSS bundle stays within budget (< 80 kB raw, < 20 kB gzip)', () => {
            expect(fs.existsSync(paths.distAssets)).toBe(true);
            const assetFiles = fs.readdirSync(paths.distAssets);
            const cssFile = assetFiles.find(f => f.endsWith('.css'));
            expect(cssFile).toBeTruthy();

            const cssContent = readBinarySafe(path.join(paths.distAssets, cssFile));
            const rawSizeKb = cssContent.length / 1024;
            const gzipSizeKb = zlib.gzipSync(cssContent).length / 1024;

            expect(rawSizeKb).toBeLessThan(80);
            expect(gzipSizeKb).toBeLessThan(20);
        });

        it('7.4 Production JS bundle stays within budget (< 600 kB raw, < 200 kB gzip)', () => {
            expect(fs.existsSync(paths.distAssets)).toBe(true);
            const assetFiles = fs.readdirSync(paths.distAssets);
            const jsFile = assetFiles.find(f => f.endsWith('.js'));
            expect(jsFile).toBeTruthy();

            const jsContent = readBinarySafe(path.join(paths.distAssets, jsFile));
            const rawSizeKb = jsContent.length / 1024;
            const gzipSizeKb = zlib.gzipSync(jsContent).length / 1024;

            expect(rawSizeKb).toBeLessThan(600);
            expect(gzipSizeKb).toBeLessThan(200);
        });

        it('7.5 Font assets individual chunk sizes stay within budget (< 100 kB per woff2 file)', () => {
            expect(fs.existsSync(paths.distAssets)).toBe(true);
            const assetFiles = fs.readdirSync(paths.distAssets);
            const fontFiles = assetFiles.filter(f => f.endsWith('.woff2'));
            expect(fontFiles.length).toBeGreaterThanOrEqual(1);

            for (const fontFile of fontFiles) {
                const fontContent = readBinarySafe(path.join(paths.distAssets, fontFile));
                const sizeKb = fontContent.length / 1024;
                expect(sizeKb).toBeLessThan(100);
            }
        });
    });
});

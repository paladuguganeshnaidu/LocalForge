const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { findBrowserExecutable } = require('../dist/browser/renderedBrowser');

async function verifyAgentWebsite(inputUrl, outputDirectory, options = {}) {
  const profile = options.profile ?? 'full';
  if (!['full', 'minimal'].includes(profile)) throw new Error('Unknown website verification profile.');
  const url = new URL(inputUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Supply an actual running loopback website URL.');
  const output = path.resolve(outputDirectory);
  await fs.mkdir(output, { recursive: true });
  const executablePath = await findBrowserExecutable();
  if (!executablePath) throw new Error('No installed browser for real website verification.');
  const browser = await chromium.launch({ executablePath, headless: true });
  const result = { url: url.href, profile, startedAt: new Date().toISOString(), consoleErrors: [], networkFailures: [], checks: {}, screenshots: [] };
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const resource = new URL(route.request().url());
      if (['data:', 'blob:'].includes(resource.protocol) || ['http:', 'https:'].includes(resource.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(resource.hostname) && !resource.username && !resource.password) return route.continue();
      result.networkFailures.push({ url: resource.href, reason: 'Non-loopback resource blocked in isolated QA' });
      return route.abort();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    if (options.require3D) await page.addInitScript(() => {
      window.__webGLVerification = { drawCalls: 0 };
      for (const contextType of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
        for (const method of ['drawArrays', 'drawElements']) {
          const original = contextType.prototype[method];
          contextType.prototype[method] = function (...args) {
            const result = original.apply(this, args);
            if (args[method === 'drawArrays' ? 2 : 1] > 0) window.__webGLVerification.drawCalls += 1;
            return result;
          };
        }
      }
    });
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    page.on('pageerror', error => result.consoleErrors.push(error.message));
    page.on('requestfailed', request => result.networkFailures.push({ url: request.url(), reason: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) result.networkFailures.push({ url: response.url(), status: response.status() }); });
    const response = await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30000 });
    result.checks.runtime = response?.ok() === true;
    if (options.require3D) {
      result.threeDimensional = await page.evaluate(() => ({ drawCalls: window.__webGLVerification?.drawCalls || 0, visibleCanvases: [...document.querySelectorAll('canvas')].filter(canvas => canvas.width > 0 && canvas.height > 0 && canvas.getBoundingClientRect().width > 0).length }));
      result.checks.threeDimensionalRendering = result.threeDimensional.drawCalls > 0 && result.threeDimensional.visibleCanvases > 0;
    }
    result.document = await page.evaluate(() => ({ title: document.title, language: document.documentElement.lang, description: document.querySelector('meta[name="description"]')?.content, favicon: document.querySelector('link[rel~="icon"]')?.getAttribute('href'), headings: [...document.querySelectorAll('h1,h2,h3')].map(element => element.textContent.trim()), mainCount: document.querySelectorAll('main').length, navCount: document.querySelectorAll('nav').length, h1Count: document.querySelectorAll('h1').length, imagesWithoutAlt: [...document.images].filter(image => !image.hasAttribute('alt')).length, unlabelledFields: [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(field => !field.labels?.length && !field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby')).length, brokenLinks: [...document.querySelectorAll('a')].filter(link => !link.getAttribute('href') || link.getAttribute('href') === '#' || link.hash.length > 1 && !document.getElementById(decodeURIComponent(link.hash.slice(1)))).map(link => ({ text: link.textContent.trim(), href: link.getAttribute('href') })) }));
    result.checks.metadata = Boolean(result.document.title && result.document.description && result.document.language && result.document.favicon);
    result.checks.faviconRendering = await page.evaluate(async () => {
      const href = document.querySelector('link[rel~="icon"]')?.href;
      if (!href) return false;
      return new Promise(resolve => {
        const image = new Image();
        const timeout = setTimeout(() => resolve(false), 5000);
        image.onload = () => { clearTimeout(timeout); resolve(image.naturalWidth > 0); };
        image.onerror = () => { clearTimeout(timeout); resolve(false); };
        image.src = href;
      });
    });
    const routeTargets = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map(link => link.href).filter(href => {
      const target = new URL(href);
      return target.origin === location.origin && (target.pathname !== location.pathname || target.search !== location.search);
    }))]);
    result.navigationRoutes = [];
    for (const target of routeTargets.slice(0, 20)) {
      try {
        const response = await page.goto(target, { waitUntil: 'networkidle', timeout: 15000 });
        result.navigationRoutes.push({ url: target, status: response?.status(), passed: response?.ok() === true });
      } catch (error) { result.navigationRoutes.push({ url: target, passed: false, error: error.message }); }
    }
    if (routeTargets.length) await page.goto(url.href, { waitUntil: 'networkidle', timeout: 30000 });
    result.checks.navigationTargets = result.document.brokenLinks.length === 0 && routeTargets.length <= 20 && result.navigationRoutes.every(route => route.passed);
    result.uncheckedNavigationRoutes = routeTargets.slice(20);
    result.checks.accessibilityBasics = result.document.mainCount === 1 && result.document.navCount >= 1 && result.document.h1Count === 1 && !result.document.imagesWithoutAlt && !result.document.unlabelledFields;
    result.checks.responsive = true;
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) result.checks.responsive = false;
      const screenshot = path.join(output, `viewport-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      result.screenshots.push({ width, overflow, path: screenshot });
    }
    if (profile === 'full') {
      const email = page.locator('input[type="email"]').first();
      result.checks.emailValidation = false;
      if (await email.count()) {
        await email.fill('invalid-email');
        const invalidRejected = await email.evaluate(field => !field.checkValidity());
        await email.fill('agent-test@example.com');
        result.checks.emailValidation = invalidRejected && await email.evaluate(field => field.checkValidity());
      }
      const range = page.locator('input[type="range"]').first();
      result.checks.pricingInteraction = false;
      if (await range.count()) {
        const before = await page.locator('body').innerText();
        await range.evaluate(field => { field.value = field.value === field.max ? field.min : field.max; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); });
        result.checks.pricingInteraction = before !== await page.locator('body').innerText();
      }
      const summary = page.locator('details summary').first();
      result.checks.faqInteraction = false;
      if (await summary.count()) {
        const before = await summary.evaluate(element => element.parentElement.open);
        await summary.click();
        result.checks.faqInteraction = before !== await summary.evaluate(element => element.parentElement.open);
      }
      await page.setViewportSize({ width: 375, height: 900 });
      const menu = page.getByRole('button', { name: /menu|navigation/i }).first();
      result.checks.mobileMenu = false;
      if (await menu.count() && await menu.isVisible()) {
        const before = await menu.getAttribute('aria-expanded');
        await menu.click();
        result.checks.mobileMenu = before !== await menu.getAttribute('aria-expanded');
      }
    } else {
      const button = page.locator('#demo-action');
      const status = page.locator('#demo-status');
      result.checks.buttonInteraction = false;
      if (await button.count() === 1 && await status.count() === 1) {
        const before = await status.innerText();
        await button.click();
        result.checks.buttonInteraction = before !== await status.innerText();
      }
    }
    await page.keyboard.press('Tab');
    result.keyboardFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 120) }));
    result.accessibilitySnapshot = await page.locator('body').ariaSnapshot();
    const interactionScreenshot = path.join(output, 'interaction-result.png');
    await page.screenshot({ path: interactionScreenshot, fullPage: true });
    result.screenshots.push({ afterInteraction: true, path: interactionScreenshot });
    result.checks.noConsoleErrors = result.consoleErrors.length === 0;
    result.checks.noNetworkFailures = result.networkFailures.length === 0;
    result.passed = Object.values(result.checks).every(Boolean);
    result.limitations = profile === 'minimal' ? 'Reduced minimal-site benchmark only: metadata, navigation, basic accessibility, responsive screenshots, demo-button interaction and console/network errors. This is not full landing-page, WCAG or production acceptance. No website source is created or changed by this verifier.' : 'Baseline automated checks, not full WCAG or production certification. Pricing detection targets a range control; FAQ detection targets semantic details; mobile-menu detection targets an accessible expanded-state button. Other implementations need targeted manual checks. No website files are created or changed by this verifier.';
  } catch (error) { result.error = error.stack || error.message; result.passed = false; }
  finally {
    await browser.close();
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  }
  return result;
}

module.exports = { verifyAgentWebsite };
if (require.main === module) verifyAgentWebsite(process.argv[2], process.argv[3]).then(result => { console.log(JSON.stringify({ passed: result.passed, checks: result.checks, error: result.error }, null, 2)); if (!result.passed) process.exitCode = 1; }).catch(error => { console.error(error); process.exitCode = 1; });

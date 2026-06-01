import { createHash } from 'node:crypto';
import { chromium, type BrowserContext, type Cookie, type Page } from 'playwright';

export interface WorkerBrowserConfig {
  baseUrl: string;
  profileDir: string;
  headless: boolean;
}

export interface WorkerCredentials {
  email: string;
  password: string;
}

export interface WorkerSessionPayload {
  sessionToken: string | null;
  cookieHeader: string;
  fp: string;
  expiresAt: string | null;
  notes: string;
}

interface BrowserStorageSnapshot {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  globals: unknown[];
}

const LOGIN_BUTTON_SELECTORS = [
  'a[href*="login"]',
  'button:has-text("Login")',
  'button:has-text("Log in")',
  'button:has-text("Sign in")',
  'text=/login|log in|sign in/i',
];

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[autocomplete="email"]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[name="Passwd"]',
  'input[autocomplete="current-password"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'button:has-text("Next")',
  'button:has-text("下一步")',
  'button:has-text("Login")',
  'button:has-text("Log in")',
  'button:has-text("Sign in")',
  'button:has-text("Continue")',
  'div[role="button"]:has-text("Next")',
  'div[role="button"]:has-text("下一步")',
  'text=/next/i',
  'text=/下一步/',
];

const GOOGLE_LOGIN_SELECTORS = [
  'button:has-text("Continue with Google")',
  'button:has-text("Sign in with Google")',
  'button:has-text("Continue with Google")',
  'a:has-text("Continue with Google")',
  'a:has-text("Sign in with Google")',
  'button:has-text("Google")',
  'a:has-text("Google")',
  'text=/continue with google|sign in with google|google/i',
];

const GOOGLE_TRY_ANOTHER_WAY_SELECTORS = [
  'button:has-text("Try another way")',
  'button:has-text("尝试其他方式")',
  'button:has-text("试试其他方式")',
  'div[role="button"]:has-text("Try another way")',
  'div[role="button"]:has-text("尝试其他方式")',
  'div[role="button"]:has-text("试试其他方式")',
  'text=/try another way/i',
  'text=/尝试其他方式|试试其他方式/',
];

const GOOGLE_PASSWORD_OPTION_SELECTORS = [
  'button:has-text("Enter your password")',
  'button:has-text("Use your password")',
  'button:has-text("输入密码")',
  'button:has-text("输入您的密码")',
  'button:has-text("使用密码")',
  'div[role="button"]:has-text("Enter your password")',
  'div[role="button"]:has-text("Use your password")',
  'div[role="button"]:has-text("输入密码")',
  'div[role="button"]:has-text("输入您的密码")',
  'div[role="button"]:has-text("使用密码")',
  'text=/enter your password|use your password/i',
  'text=/输入密码|输入您的密码|使用密码/',
];

const LOGGED_IN_SELECTORS = [
  'textarea',
  'button:has-text("Humanize")',
  'button:has-text("Humanize More")',
  'button:has-text("Scan")',
  'button:has-text("Logout")',
  'button:has-text("Log out")',
  '[data-testid="user-menu"]',
];

async function firstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function waitForFirstVisibleLocator(
  page: Page,
  selectors: string[],
  timeoutMs = 20_000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const locator = await firstVisibleLocator(page, selectors);
    if (locator) return locator;
    await page.waitForTimeout(500);
  }

  return null;
}

function redactSensitiveText(text: string, email: string) {
  return text
    .replaceAll(email, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

async function describeAuthPage(page: Page, email: string) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').first().textContent().catch(() => '');

  return `url=${url}; title=${title}; text=${redactSensitiveText(bodyText || '', email)}`;
}

async function chooseGooglePasswordFallback(page: Page) {
  const tryAnotherWay = await waitForFirstVisibleLocator(page, GOOGLE_TRY_ANOTHER_WAY_SELECTORS, 10_000);
  if (tryAnotherWay) {
    await tryAnotherWay.click();
    await page.waitForTimeout(1000);
  }

  const passwordOption = await waitForFirstVisibleLocator(page, GOOGLE_PASSWORD_OPTION_SELECTORS, 10_000);
  if (passwordOption) {
    await passwordOption.click();
    await page.waitForTimeout(1000);
  }
}

export function buildCookieHeader(cookies: Pick<Cookie, 'name' | 'value'>[]): string {
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function parseCookieHeaderForContext(
  cookieHeader: string,
  baseUrl: string,
  expiresAt: string | null = null,
): Cookie[] {
  const url = new URL(baseUrl);
  const domain = url.hostname;
  const secure = url.protocol === 'https:';
  const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const expires = Number.isFinite(expiresMs) ? Math.floor(expiresMs / 1000) : undefined;

  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf('=');
      const name = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? '' : entry.slice(separatorIndex + 1);

      return {
        name,
        value,
        domain,
        path: '/',
        secure,
        sameSite: 'Lax',
        ...(expires ? { expires } : {}),
      } as Cookie;
    })
    .filter((cookie) => cookie.name && cookie.value);
}

export function extractSessionToken(cookies: Pick<Cookie, 'name' | 'value'>[]): string | null {
  const exactNames = ['session_token', '__session', 'next-auth.session-token'];
  const exact = cookies.find((cookie) => exactNames.includes(cookie.name));
  if (exact?.value) return exact.value;

  const fuzzy = cookies.find((cookie) => /session|auth|token/i.test(cookie.name));
  return fuzzy?.value || null;
}

function scanForFp(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed) && /fp|finger/i.test(trimmed) === false) {
      return trimmed;
    }

    try {
      return scanForFp(JSON.parse(trimmed));
    } catch {
      return /[A-Za-z0-9_-]{8,}/.test(trimmed) ? trimmed : null;
    }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = scanForFp(entry);
      if (found) return found;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['fp', 'fingerprint', 'visitorId', 'deviceId']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    for (const entry of Object.values(record)) {
      const found = scanForFp(entry);
      if (found) return found;
    }
  }

  return null;
}

export function pickFpCandidate(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const found = scanForFp(candidate);
    if (found) return found;
  }

  return null;
}

function buildFallbackFp(cookieHeader: string) {
  return `browser_${createHash('sha256').update(cookieHeader).digest('hex').slice(0, 16)}`;
}

function extractExpiresAt(cookies: Cookie[]): string | null {
  const expiringCookies = cookies
    .filter((cookie) => typeof cookie.expires === 'number' && cookie.expires > 0)
    .sort((a, b) => b.expires - a.expires);

  if (expiringCookies.length === 0) return null;
  return new Date(expiringCookies[0].expires * 1000).toISOString();
}

async function readBrowserStorage(page: Page): Promise<BrowserStorageSnapshot> {
  return page.evaluate(() => {
    const localStorageEntries: Record<string, string> = {};
    const sessionStorageEntries: Record<string, string> = {};

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      localStorageEntries[key] = window.localStorage.getItem(key) ?? '';
    }

    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key) continue;
      sessionStorageEntries[key] = window.sessionStorage.getItem(key) ?? '';
    }

    const globals = [
      (window as any).fp,
      (window as any).__fp,
      (window as any).__NEXT_DATA__,
      (window as any).__NUXT__,
      (window as any).__INITIAL_STATE__,
    ];

    return {
      localStorage: localStorageEntries,
      sessionStorage: sessionStorageEntries,
      globals,
    };
  });
}

export async function createPersistentBrowserContext(config: WorkerBrowserConfig) {
  return chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 1080 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

export async function seedStealthwriterBrowserSession(
  page: Page,
  context: BrowserContext,
  baseUrl: string,
  session: Pick<WorkerSessionPayload, 'cookieHeader' | 'fp' | 'expiresAt'>,
) {
  const cookies = parseCookieHeaderForContext(session.cookieHeader, baseUrl, session.expiresAt);
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  if (session.fp.trim()) {
    await page.evaluate((fp) => {
      window.localStorage.setItem('fp', fp);
      window.sessionStorage.setItem('fp', fp);
    }, session.fp);
  }
  await page.waitForTimeout(1000);
}

export async function ensureStealthwriterHome(
  page: Page,
  baseUrl: string,
): Promise<void> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    if (new URL(page.url()).pathname.startsWith('/dashboard')) {
      return true;
    }
  } catch {
    // Ignore non-standard page URLs from mocks or about:blank pages.
  }

  const loginButton = await firstVisibleLocator(page, LOGIN_BUTTON_SELECTORS);
  if (loginButton) return false;

  const loggedInMarker = await firstVisibleLocator(page, LOGGED_IN_SELECTORS);
  return Boolean(loggedInMarker);
}

export async function loginToStealthwriter(
  page: Page,
  baseUrl: string,
  credentials: WorkerCredentials,
): Promise<'reused' | 'relogged'> {
  await ensureStealthwriterHome(page, baseUrl);

  if (await isLoggedIn(page)) {
    return 'reused';
  }

  const loginTrigger = await firstVisibleLocator(page, LOGIN_BUTTON_SELECTORS);
  if (!loginTrigger) {
    throw new Error('StealthWriter 登录入口未找到。');
  }

  await loginTrigger.click();
  await page.waitForTimeout(1000);

  const googleLogin = await waitForFirstVisibleLocator(page, GOOGLE_LOGIN_SELECTORS, 10_000);
  if (!googleLogin) {
    throw new Error('StealthWriter Google 登录入口未找到。');
  }

  const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await googleLogin.click();
  const authPage = await popupPromise || page;
  await authPage.waitForLoadState('domcontentloaded').catch(() => undefined);
  await authPage.waitForTimeout(1000);

  const emailInput = await waitForFirstVisibleLocator(authPage, EMAIL_SELECTORS);
  if (!emailInput) {
    throw new Error(`Google 登录邮箱输入框未找到。${await describeAuthPage(authPage, credentials.email)}`);
  }

  await emailInput.fill(credentials.email);

  const emailSubmitButton = await waitForFirstVisibleLocator(authPage, SUBMIT_SELECTORS);
  if (!emailSubmitButton) {
    throw new Error('Google 登录下一步按钮未找到。');
  }

  await emailSubmitButton.click();
  await authPage.waitForLoadState('domcontentloaded').catch(() => undefined);
  await authPage.waitForTimeout(1000);

  await chooseGooglePasswordFallback(authPage);
  const passwordInput = await waitForFirstVisibleLocator(authPage, PASSWORD_SELECTORS);
  if (!passwordInput) {
    throw new Error(`Google 登录密码输入框未找到。${await describeAuthPage(authPage, credentials.email)}`);
  }

  await passwordInput.fill(credentials.password);

  const passwordSubmitButton = await waitForFirstVisibleLocator(authPage, SUBMIT_SELECTORS);
  if (!passwordSubmitButton) {
    throw new Error('Google 登录提交按钮未找到。');
  }

  await passwordSubmitButton.click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(3000);
  await ensureStealthwriterHome(page, baseUrl);

  if (!(await isLoggedIn(page))) {
    throw new Error('StealthWriter 自动登录失败。');
  }

  return 'relogged';
}

export async function extractStealthwriterSession(
  page: Page,
  context: BrowserContext,
): Promise<WorkerSessionPayload> {
  const cookies = await context.cookies();
  const storage = await readBrowserStorage(page);
  const cookieHeader = buildCookieHeader(cookies);
  const fp = pickFpCandidate([
    storage.globals,
    storage.localStorage,
    storage.sessionStorage,
    ...Object.values(storage.localStorage),
    ...Object.values(storage.sessionStorage),
  ]) || buildFallbackFp(cookieHeader);

  if (!cookieHeader) {
    throw new Error('StealthWriter cookie 读取失败。');
  }
  if (!fp) {
    throw new Error('StealthWriter fp 读取失败。');
  }

  return {
    sessionToken: extractSessionToken(cookies),
    cookieHeader,
    fp,
    expiresAt: extractExpiresAt(cookies),
    notes: 'worker_refresh',
  };
}

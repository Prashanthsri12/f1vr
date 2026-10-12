// OpenF1 client: URL building, a single serial rate-limited request queue,
// and cache-first JSON fetching. Pure module (no three.js); runs under Node.

import { cacheGet, cachePut } from './cache.js';

/** OpenF1 REST base URL (no trailing slash). */
export const BASE_URL = 'https://api.openf1.org/v1';

const OPERATOR_RE = /^(.*?)(>=|<=|>|<)$/;
const OPERATOR_ENC = { '>=': '%3E%3D', '<=': '%3C%3D', '>': '%3E', '<': '%3C' };

/**
 * Build a full OpenF1 URL. Keys ending in `>=`, `<=`, `>` or `<` become
 * `field%3E%3Dvalue` etc.; other keys are `key=value`. Values are
 * encodeURIComponent'd (verified: the API accepts `%3A` in dates).
 * `null`/`undefined` values are skipped; Date values become ISO strings.
 * Key order is insertion order.
 * @param {string} endpoint e.g. 'location' (a leading '/' is ignored)
 * @param {Record<string, string|number|boolean|Date|null|undefined>} [params]
 * @returns {string}
 */
export function buildUrl(endpoint, params = {}) {
  const parts = [];
  for (const key of Object.keys(params)) {
    let value = params[key];
    if (value === undefined || value === null) continue;
    if (value instanceof Date) value = value.toISOString();
    const v = encodeURIComponent(String(value));
    const m = OPERATOR_RE.exec(key);
    if (m) parts.push(encodeURIComponent(m[1]) + OPERATOR_ENC[m[2]] + v);
    else parts.push(encodeURIComponent(key) + '=' + v);
  }
  const path = BASE_URL + '/' + String(endpoint).replace(/^\/+/, '');
  return parts.length ? path + '?' + parts.join('&') : path;
}

/** Error for a failed API request (non-2xx after retries, or network failure). */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, url?: string, body?: any, cause?: any}} [info]
   */
  constructor(message, { status = 0, url = '', body, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ApiError';
    /** HTTP status, or 0 for a network error */
    this.status = status;
    /** request URL */
    this.url = url;
    /** parsed response body, if any */
    this.body = body;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultFetch = (url, init) => globalThis.fetch(url, init);

function isRetryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Parse a Retry-After header (seconds or HTTP date) to ms, or null. */
function parseRetryAfter(value, nowMs) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

async function readBody(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

/**
 * Serial request queue enforcing per-second and per-minute sliding windows
 * (counted by request start times, retries included). Higher priority runs
 * first; FIFO within a priority. Retries 429/5xx and network errors with
 * exponential backoff (1 s, 2 s, 4 s … + jitter), honouring Retry-After.
 */
export class RequestQueue {
  /**
   * @param {object} [opts]
   * @param {number} [opts.perSecond=3]
   * @param {number} [opts.perMinute=30]
   * @param {(url: string, init?: object) => Promise<Response>} [opts.fetchFn]
   * @param {() => number} [opts.now] clock in ms
   * @param {(ms: number) => Promise<void>} [opts.sleep]
   * @param {number} [opts.maxRetries=5] retries after the first attempt
   * @param {() => number} [opts.random] jitter source in [0,1)
   * @param {number} [opts.baseDelayMs=1000] first backoff delay
   */
  constructor({
    perSecond = 3, perMinute = 30, fetchFn = defaultFetch, now = Date.now,
    sleep = defaultSleep, maxRetries = 5, random = Math.random, baseDelayMs = 1000,
  } = {}) {
    this.perSecond = perSecond;
    this.perMinute = perMinute;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this._fetch = fetchFn;
    this._now = now;
    this._sleep = sleep;
    this._random = random;
    this._queue = [];      // sorted: priority desc, then seq asc
    this._starts = [];     // request start times within the last minute
    this._seq = 0;
    this._inFlight = false;
    this._running = false;
  }

  /** Number of requests queued plus the one in flight (if any). */
  get pending() {
    return this._queue.length + (this._inFlight ? 1 : 0);
  }

  /**
   * Queue a GET request; resolves with the parsed JSON body.
   * @param {string} url
   * @param {{priority?: number}} [opts]
   * @returns {Promise<any>} rejects with ApiError
   */
  enqueue(url, { priority = 0 } = {}) {
    return new Promise((resolve, reject) => {
      const item = { url, priority, seq: this._seq++, resolve, reject };
      // insert after every item with priority >= this one (keeps FIFO)
      const q = this._queue;
      let i = q.length;
      while (i > 0 && q[i - 1].priority < priority) i--;
      q.splice(i, 0, item);
      if (!this._running) this._run();
    });
  }

  async _run() {
    this._running = true;
    try {
      while (this._queue.length) {
        const item = this._queue.shift();
        this._inFlight = true;
        try {
          item.resolve(await this._execute(item.url));
        } catch (err) {
          item.reject(err);
        } finally {
          this._inFlight = false;
        }
      }
    } finally {
      this._running = false;
    }
  }

  /** Wait until starting a request now respects both windows, then record it. */
  async _acquireSlot() {
    for (;;) {
      const now = this._now();
      const s = this._starts;
      while (s.length && s[0] <= now - 60000) s.shift();
      let wait = 0;
      if (s.length >= this.perMinute) {
        wait = Math.max(wait, s[s.length - this.perMinute] + 60000 - now);
      }
      // count starts in the last second
      let inSecond = 0;
      for (let i = s.length - 1; i >= 0 && s[i] > now - 1000; i--) inSecond++;
      if (inSecond >= this.perSecond) {
        wait = Math.max(wait, s[s.length - this.perSecond] + 1000 - now);
      }
      if (wait <= 0) {
        s.push(now);
        return;
      }
      await this._sleep(wait);
    }
  }

  async _execute(url) {
    let attempt = 0;
    for (;;) {
      await this._acquireSlot();
      let res;
      try {
        const f = this._fetch;
        res = await f(url, { headers: { Accept: 'application/json' } });
      } catch (cause) {
        if (attempt >= this.maxRetries) {
          throw new ApiError(`Network error for ${url}: ${cause?.message ?? cause}`, { url, cause });
        }
        await this._sleep(this._backoff(attempt++, null));
        continue;
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch (cause) {
          throw new ApiError(`Invalid JSON from ${url}`, { status: res.status, url, cause });
        }
      }
      if (isRetryable(res.status) && attempt < this.maxRetries) {
        const retryAfter = parseRetryAfter(res.headers?.get?.('Retry-After'), this._now());
        await readBody(res); // drain
        await this._sleep(this._backoff(attempt++, retryAfter));
        continue;
      }
      const body = await readBody(res);
      throw new ApiError(`HTTP ${res.status} for ${url}`, { status: res.status, url, body });
    }
  }

  /** Backoff delay in ms for a retry attempt (0-based). */
  _backoff(attempt, retryAfterMs) {
    const base = this.baseDelayMs * 2 ** attempt;
    const jittered = base + this._random() * base * 0.25;
    return retryAfterMs != null ? Math.max(jittered, retryAfterMs) : jittered;
  }
}

/** @type {RequestQueue|null} */
let sharedQueue = null;

/**
 * The shared default queue (3/s, 30/min) used by fetchJson.
 * @returns {RequestQueue}
 */
export function getQueue() {
  if (!sharedQueue) sharedQueue = new RequestQueue();
  return sharedQueue;
}

/** Concurrent fetchJson calls for the same URL share one request. */
const inFlight = new Map();

function isNoResults(data) {
  return data != null && typeof data === 'object' && !Array.isArray(data) && 'detail' in data;
}

/**
 * Cache-first JSON fetch through the shared queue. A 404 or `{detail: ...}`
 * ("No results found.") response resolves to `[]`, which is cached too.
 * @param {string} endpoint e.g. 'laps'
 * @param {object} [params] see buildUrl
 * @param {{priority?: number, cache?: boolean}} [opts] cache=false bypasses read and write
 * @returns {Promise<any[]>}
 */
export async function fetchJson(endpoint, params = {}, { priority = 0, cache = true } = {}) {
  const url = buildUrl(endpoint, params);
  if (cache) {
    const hit = await cacheGet(url);
    if (hit !== undefined) return hit;
  }
  const key = cache ? url : null;
  if (key && inFlight.has(key)) return inFlight.get(key);

  const p = (async () => {
    let data;
    try {
      data = await getQueue().enqueue(url, { priority });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      data = [];
    }
    if (isNoResults(data)) data = [];
    if (cache) await cachePut(url, data);
    return data;
  })();

  if (key) {
    inFlight.set(key, p);
    p.then(() => inFlight.delete(key), () => inFlight.delete(key));
  }
  return p;
}

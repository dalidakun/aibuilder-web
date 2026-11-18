/* 乘法自选 · 临界点 / 比价关系
 *
 * 纯静态页面：所有数据由浏览器直接向数据源请求。
 *   - 同花顺金融数据服务 https://fuyao.aicubes.cn（访问者自己的 API Key）
 *   - 同花顺板块分钟线 / 周线 https://d.10jqka.com.cn（免 Key）
 *   - 腾讯行情 qt.gtimg.cn / ifzq.gtimg.cn（实时快照、60 分钟线）
 *   - 东方财富数据中心 datacenter-web.eastmoney.com（财务、分红）
 *
 * 左侧 320 个行业板块常驻；偏离度按板块按需计算，算过就缓存在本机。
 * MA 固定 250。
 */
(function () {
  'use strict';

  var THS_BASE = 'https://fuyao.aicubes.cn';
  var THS_LINE = 'https://d.10jqka.com.cn/v6/line/';
  var EM_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  var TX_QUOTE = 'https://qt.gtimg.cn/q=';
  var TX_MIN = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline';

  var LS = {
    key: 'stk_ths_key_v1',
    prefs: 'stk_prefs_v1',
    catalog: 'stk_catalog_v1',
    pool: 'stk_pool_cache_v1',
    stock: 'stk_stock_cache_v1',
    board: 'stk_board_cache_v1',
    pinned: 'stk_pinned_compare_v1',
    bottom: 'stk_bottom_compare_v1',
    sideCollapsed: 'stk_side_collapsed_v1',
  };

  var MA = 250;
  var PERIODS = ['60', 'd', 'w'];
  var PERIOD_LABEL = { 60: '1 小时', d: '日线', w: '周线' };
  var STOCK_TTL = 30 * 60 * 1000;
  var BOARD_TTL = 30 * 60 * 1000;
  var CATALOG_TTL = 7 * 86400 * 1000;

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var state = {
    key: '',
    keyValid: null,
    tab: 'pool',
    catalog: [],
    catalogLoading: false,
    boardPeriod: 'd',
    stockPeriod: '60',
    devs: {},
    devTs: 0,
    filter: '',
    userTyped: false,
    sort: { col: 'dev', desc: true },
    busy: false,
    abort: null,
    calcCode: '',
    selected: null,
    pinned: [],
    bottom: [],
    ctxCode: '',
    sideCollapsed: false,
    stockSel: { pool: '', compare: '' },
    detail: { code: '', name: '', period: '60', bars: [], token: 0, finToken: 0, hover: -1, geom: null },
    pool: { code: '', period: '', rows: [], ts: 0, token: 0, loading: false, sort: { col: 'dev', desc: true } },
    compare: { code: '', rows: [], ts: 0, token: 0, loading: false },
  };

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */
  /* ------------------------------------------------------------------ */

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) ? n : null;
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function mean(list) {
    if (!list || !list.length) return 0;
    var s = 0;
    for (var i = 0; i < list.length; i++) s += list[i];
    return s / list.length;
  }

  function fmtMoney(v) {
    if (!isNum(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + ' 万亿';
    if (a >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
    if (a >= 1e4) return (v / 1e4).toFixed(2) + ' 万';
    return v.toFixed(0);
  }

  function fmtPct(v) {
    return isNum(v) ? v.toFixed(2) + '%' : '—';
  }

  function fmtSignedPct(v) {
    if (!isNum(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function fmtNum(v, digits) {
    return isNum(v) ? v.toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) : '—';
  }

  function fmtPrice(v) {
    return isNum(v) ? v.toFixed(2) : '—';
  }

  function fmtPE(v) {
    if (!isNum(v)) return '—';
    if (v <= 0) return '亏损';
    return v.toFixed(2);
  }

  function trendClass(v) {
    if (!isNum(v) || v === 0) return '';
    return v > 0 ? 'stk-up' : 'stk-down';
  }

  function timeLabel(ms) {
    if (!isNum(ms) || ms <= 0) return '—';
    var d = new Date(ms);
    var now = new Date();
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return hm;
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hm;
  }

  function secuCode(code) {
    if (/^(4|8|92)/.test(code)) return code + '.BJ';
    if (/^(6|9)/.test(code)) return code + '.SH';
    return code + '.SZ';
  }

  function txSymbol(code) {
    if (/^(6|9)/.test(code)) return 'sh' + code;
    if (/^(4|8|92)/.test(code)) return 'bj' + code;
    return 'sz' + code;
  }

  function readLS(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      try {
        localStorage.removeItem(LS.pool);
        localStorage.removeItem(LS.stock);
        localStorage.removeItem(LS.board);
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  var toastTimer = null;
  function toast(message, kind) {
    var el = $('stkToast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.style.background = kind === 'err' ? 'var(--stk-up)' : '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function setEmpty(id, on, html) {
    var el = $(id);
    if (!el) return;
    el.hidden = !on;
    if (html !== undefined) el.innerHTML = html;
  }

  function setWrapLoading(id, on) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle('is-loading', !!on);
  }

  function markSort(selector, col, desc) {
    $$(selector).forEach(function (th) {
      var base = th.dataset.label || th.textContent.replace(/[↑↓]\s*$/, '').trim();
      th.dataset.label = base;
      th.textContent = base;
      if (th.dataset.sort === col) {
        var span = document.createElement('span');
        span.className = 'stk-arrow';
        span.textContent = desc ? '↓' : '↑';
        th.appendChild(span);
      }
    });
  }

  function periodLabel(period) {
    return PERIOD_LABEL[period] || '日线';
  }

  function dayStart(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function windowDays(period, n) {
    if (period === 'w') return Math.min(3500, Math.ceil(n * 7 * 1.45) + 60);
    return Math.ceil(n * 1.55) + 45;
  }

  function calcRow(info, closes, n) {
    if (!closes || closes.length < n) return null;
    var last = closes[closes.length - 1];
    var avg = mean(closes.slice(-n));
    if (!(avg > 0)) return null;
    var prev = closes.length >= 2 ? closes[closes.length - 2] : null;
    return {
      code: info.code,
      name: info.name || info.code,
      close: last,
      ma: avg,
      dev: (last / avg - 1) * 100,
      chg: prev ? (last / prev - 1) * 100 : null,
      bars: closes.length,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 网络                                                               */
  /* ------------------------------------------------------------------ */

  function makeAbortError() {
    try { return new DOMException('已停止', 'AbortError'); } catch (e) { return new Error('已停止'); }
  }

  function isAbort(e) {
    return !!e && (e.name === 'AbortError' || e.message === '已停止');
  }

  async function fetchText(url, opts) {
    opts = opts || {};
    var signal = opts.signal;
    var timeout = opts.timeout || 25000;
    var retries = opts.retries || 0;
    var lastErr = null;

    if (signal && signal.aborted) throw makeAbortError();

    for (var attempt = 0; attempt <= retries; attempt++) {
      if (signal && signal.aborted) throw makeAbortError();
      var ctrl = new AbortController();
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeout);
      var onAbort = function () { ctrl.abort(); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        var res = await fetch(url, {
          method: 'GET',
          headers: opts.headers || {},
          signal: ctrl.signal,
          cache: opts.cache || 'no-store',
          credentials: 'omit',
          referrerPolicy: opts.referrerPolicy || 'no-referrer',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var buf = await res.arrayBuffer();
        var text;
        try {
          text = new TextDecoder(opts.encoding || 'utf-8').decode(buf);
        } catch (e) {
          text = new TextDecoder('utf-8').decode(buf);
        }
        return text;
      } catch (e) {
        lastErr = timedOut ? new Error('请求超时') : e;
        if (signal && signal.aborted) throw makeAbortError();
        if (attempt < retries) await sleep(500 * (attempt + 1));
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr || new Error('网络请求失败');
  }

  async function fetchJson(url, opts) {
    var text = await fetchText(url, opts);
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('数据源返回的不是 JSON（可能被限流，请稍后重试）');
    }
  }

  function thsMessage(code, message) {
    var hint = {
      1001: '缺少参数',
      1002: '参数格式不对',
      1003: '查询范围超出限制',
      2001: '没有带 API Key',
      2003: 'API Key 无效或没有权限',
      3001: '标的或板块不存在',
      3002: '数据尚未就绪',
      3004: '该标的类型不支持此接口',
      4001: '同花顺接口限流，请稍后重试',
    }[Number(code)] || '';
    var base = '同花顺接口错误(' + code + ')' + (message ? '：' + message : '');
    return hint ? base + '（' + hint + '）' : base;
  }

  async function thsGetWithKey(key, path, params, opts) {
    if (!key) throw new Error('请先设置同花顺 API Key');
    var url = new URL(THS_BASE + path);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
    });

    opts = opts || {};
    var attempts = 0;
    while (true) {
      var json;
      try {
        json = await fetchJson(url.toString(), {
          headers: { 'X-api-key': key },
          signal: opts.signal,
          timeout: opts.timeout || 25000,
        });
      } catch (e) {
        if (isAbort(e)) throw e;
        if (attempts < 2 && !(opts.signal && opts.signal.aborted)) {
          attempts += 1;
          await sleep(600 * attempts);
          continue;
        }
        throw e;
      }
      if (json && json.code === 0) return json.data;
      var code = Number(json && json.code);
      if ((code === 4001 || code >= 5000) && attempts < 2 && !(opts.signal && opts.signal.aborted)) {
        attempts += 1;
        await sleep(700 * attempts);
        continue;
      }
      throw new Error(thsMessage(code, json && json.message));
    }
  }

  function thsGet(path, params, opts) {
    return thsGetWithKey(state.key, path, params, opts);
  }

  async function testKeyValue(key) {
    await thsGetWithKey(key, '/api/meta/tickers/search', { q: '600519', limit: 1 }, { timeout: 15000 });
    return true;
  }

  function requireKey() {
    if (state.key) return true;
    openKeyModal();
    toast('请先设置同花顺 API Key', 'err');
    return false;
  }

  function handleApiError(e) {
    var msg = String((e && e.message) || '');
    if (/2003|2001|API Key 无效|没有权限/.test(msg)) {
      state.keyValid = false;
      renderApiBtn();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 板块目录                                                           */
  /* ------------------------------------------------------------------ */

  async function fetchStaticCatalog() {
    var url = new URL('../assets/data/stock-boards.json', location.href).toString();
    var j = await fetchJson(url, { timeout: 15000 });
    return (Array.isArray(j.boards) ? j.boards : []).filter(function (b) {
      return b && b.tag === '行业';
    });
  }

  async function fetchApiCatalog() {
    var data = await thsGet('/api/a-share-index/catalog/ths-index-list', { tag: 'industry' }, { timeout: 20000 });
    var out = [];
    (data && data.item ? data.item : []).forEach(function (x) {
      var code = String(x.thscode || '').split('.')[0];
      var name = String(x.name || '').trim();
      if (/^\d{6}$/.test(code) && name) out.push({ code: code, name: name, tag: '行业' });
    });
    return out;
  }

  function applyCatalog(boards) {
    if (!Array.isArray(boards) || !boards.length) return;
    state.catalog = boards;
    if (state.selected && !boards.some(function (b) { return b.code === state.selected.code; })) {
      state.selected = null;
    }
    renderSide();
  }

  async function loadCatalog() {
    if (state.catalogLoading) return;
    state.catalogLoading = true;
    var cached = readLS(LS.catalog, null);
    try {
      if (cached && Array.isArray(cached.boards) && cached.boards.length) {
        applyCatalog(cached.boards.filter(function (b) { return b.tag === '行业'; }));
      }
      if (!state.catalog.length) {
        var staticBoards = await fetchStaticCatalog();
        if (staticBoards.length) applyCatalog(staticBoards);
      }
    } catch (e) {
      if (!state.catalog.length) toast('板块目录加载失败：' + e.message, 'err');
    }
    var fresh = cached && cached.ts && Date.now() - cached.ts < CATALOG_TTL;
    if (state.key && !fresh) refreshCatalog().catch(function () {});
    state.catalogLoading = false;
  }

  async function refreshCatalog() {
    try {
      var boards = await fetchApiCatalog();
      if (boards.length >= 250) {
        applyCatalog(boards);
        writeLS(LS.catalog, { ts: Date.now(), boards: boards });
      }
    } catch (e) {
      // 目录刷新失败不影响静态目录
    }
  }

  function findBoard(q) {
    var text = String(q || '').trim();
    if (!text) return null;
    var lower = text.toLowerCase();
    return state.catalog.find(function (b) { return String(b.code).toLowerCase() === lower; }) ||
      state.catalog.find(function (b) { return String(b.name).toLowerCase() === lower; }) ||
      state.catalog.find(function (b) { return String(b.name).toLowerCase().indexOf(lower) >= 0; }) ||
      state.catalog.find(function (b) { return String(b.code).indexOf(lower) >= 0; }) ||
      null;
  }

  /* ------------------------------------------------------------------ */
  /* 板块偏离度（按板块按需计算）                                        */
  /* ------------------------------------------------------------------ */

  function readDevCache(period) {
    var all = readLS(LS.pool, {});
    var ent = all[period];
    if (!ent || !Array.isArray(ent.rows)) return null;
    return ent;
  }

  function loadDevs(period) {
    var ent = readDevCache(period);
    state.devs = {};
    state.devTs = 0;
    if (ent) {
      ent.rows.forEach(function (r) {
        if (r && r.code && isNum(r.dev)) state.devs[r.code] = r;
      });
      state.devTs = ent.ts || 0;
    }
    renderSide();
  }

  function saveDev(period, row) {
    var all = readLS(LS.pool, {});
    var ent = all[period] || { ts: 0, rows: [] };
    var rows = (ent.rows || []).filter(function (r) { return r.code !== row.code; });
    rows.push(row);
    all[period] = { ts: Date.now(), rows: rows };
    writeLS(LS.pool, all);
  }

  function sideRows() {
    var filter = state.filter.trim().toLowerCase();
    var rows = state.catalog.map(function (b) {
      var d = state.devs[b.code];
      return { code: b.code, name: b.name, dev: d ? d.dev : null, row: d || null };
    }).filter(function (r) {
      if (!filter) return true;
      return String(r.name || '').toLowerCase().indexOf(filter) >= 0 ||
        String(r.code || '').toLowerCase().indexOf(filter) >= 0;
    });

    var sort = state.sort;
    rows.sort(function (a, b) {
      if (sort.col === 'name') {
        var sa = String(a.name || '');
        var sb = String(b.name || '');
        return sort.desc ? sb.localeCompare(sa, 'zh-CN') : sa.localeCompare(sb, 'zh-CN');
      }
      var ad = isNum(a.dev);
      var bd = isNum(b.dev);
      if (ad !== bd) return ad ? -1 : 1; // 算过的排前面
      if (ad && bd) return sort.desc ? b.dev - a.dev : a.dev - b.dev;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    });
    return rows;
  }

  function renderSide() {
    var tbody = $('stkBoardBody');
    if (!tbody) return;
    var rows = sideRows();
    var selected = state.selected;
    tbody.innerHTML = rows.map(function (r) {
      var isOn = selected && selected.code === r.code;
      var devHtml = r.dev === null
        ? '<span class="stk-none">暂无</span>'
        : '<span class="' + trendClass(r.dev) + '">' + fmtSignedPct(r.dev) + '</span>';
      return '<tr' + (isOn ? ' class="is-selected"' : '') + ' data-code="' + esc(r.code) + '" data-name="' + esc(r.name) + '">' +
        '<td class="stk-name" title="' + esc(r.name || r.code) + '">' + esc(r.name || r.code) + '</td>' +
        '<td class="stk-mid">' + (state.calcCode === r.code ? '<span class="stk-progress stk-progress--indeterminate" title="计算中"><span class="stk-progress__fill"></span></span>' : '') + '</td>' +
        '<td class="is-num">' + devHtml + '</td>' +
        '</tr>';
    }).join('');
    setEmpty('stkBoardEmpty', rows.length === 0, '没有匹配的板块');
    markSort('#stkBoardWrap th.is-sortable', state.sort.col, state.sort.desc);
  }

  function setCalcBusy(on) {
    var btn = $('stkCalcBoard');
    if (btn) {
      btn.classList.toggle('is-busy', !!on);
      btn.setAttribute('aria-label', on ? '停止计算' : '计算该板块的偏离度');
    }
    var refresh = $('stkRefreshStocks');
    if (refresh) refresh.hidden = !!on;
    var bar = $('stkCalcProgress');
    if (bar) {
      bar.hidden = !on;
      if (!on) {
        bar.classList.remove('stk-progress--indeterminate');
        var fill = bar.querySelector('.stk-progress__fill');
        if (fill) fill.style.width = '0%';
        bar.removeAttribute('aria-valuenow');
        bar.title = '';
      }
    }
  }

  function setCalcProgress(done, total) {
    var bar = $('stkCalcProgress');
    if (!bar) return;
    bar.hidden = false;
    bar.classList.remove('stk-progress--indeterminate');
    var pct = total > 0 ? Math.max(0, Math.min(100, done / total * 100)) : 0;
    var fill = bar.querySelector('.stk-progress__fill');
    if (fill) fill.style.width = pct + '%';
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.title = '计算中 ' + done + '/' + total;
  }

  function setCalcIndeterminate() {
    var bar = $('stkCalcProgress');
    if (!bar) return;
    bar.hidden = false;
    bar.classList.add('stk-progress--indeterminate');
    var fill = bar.querySelector('.stk-progress__fill');
    if (fill) fill.style.width = '';
    bar.removeAttribute('aria-valuenow');
    bar.title = '计算中';
  }

  function parseD10Closes(text) {
    var m = text.match(/\(([\s\S]*)\)\s*;?\s*$/);
    if (!m) return [];
    var j;
    try { j = JSON.parse(m[1]); } catch (e) { return []; }
    var out = [];
    String(j && j.data ? j.data : '').split(';').forEach(function (x) {
      if (!x) return;
      var p = x.split(',');
      if (p.length < 5) return;
      var c = num(p[4]);
      if (isNum(c)) out.push({ t: String(p[0]), c: c });
    });
    out.sort(function (a, b) { return a.t.localeCompare(b.t); });
    return out.map(function (x) { return x.c; });
  }

  async function fetchBoard60(code, signal) {
    var year = new Date().getFullYear();
    var paths = [
      'bk_' + code + '/50/' + year + '.js',
      'bk_' + code + '/50/last.js',
    ];
    var best = [];
    for (var i = 0; i < paths.length; i++) {
      try {
        var text = await fetchText(THS_LINE + paths[i], {
          signal: signal,
          timeout: 20000,
          retries: 2,
          cache: 'default',
          referrerPolicy: 'strict-origin-when-cross-origin',
        });
        var closes = parseD10Closes(text);
        if (closes.length > best.length) best = closes;
        if (best.length >= MA) return best;
      } catch (e) {
        if (isAbort(e)) throw e;
      }
    }
    return best;
  }

  async function fetchBoardWeekly(code, signal) {
    try {
      var text = await fetchText(THS_LINE + 'bk_' + code + '/11/last.js', {
        signal: signal,
        timeout: 20000,
        retries: 2,
        cache: 'default',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      return parseD10Closes(text);
    } catch (e) {
      if (isAbort(e)) throw e;
      return [];
    }
  }

  async function fetchDailyBars(code, signal, days) {
    var data = await thsGet('/api/a-share-index/prices/historical-batch', {
      thscodes: code + '.TI',
      interval: '1d',
      start: dayStart(Date.now() - (days || windowDays('d', MA)) * 86400000),
      end: dayStart(Date.now()) + 86399999,
    }, { signal: signal, timeout: 30000 });
    var group = (data && data.item ? data.item : [])[0];
    if (!group) return [];
    return (group.item || []).map(function (x) {
      return { t: num(x.date_ms), c: num(x.close_price) };
    }).filter(function (b) { return isNum(b.t) && isNum(b.c); });
  }

  async function fetchDailyBoard(code, signal, days) {
    return (await fetchDailyBars(code, signal, days)).map(function (b) { return b.c; });
  }

  function weeklyCloses(bars) {
    var map = new Map();
    (bars || []).forEach(function (b) {
      var day = (new Date(b.t).getUTCDay() + 6) % 7;
      var monday = b.t - day * 86400000;
      map.set(monday, b.c);
    });
    return Array.from(map.keys()).sort(function (a, b) { return a - b; })
      .map(function (k) { return map.get(k); });
  }

  async function calcSingleDev(code, name, period, signal) {
    var closes;
    if (period === '60') {
      closes = await fetchBoard60(code, signal);
    } else if (period === 'w') {
      closes = await fetchBoardWeekly(code, signal);
      // 10jqka 偶发 502 / 短数据时，用同花顺 5 年日线聚合成周线兜底
      if (!closes || closes.length < MA) {
        closes = weeklyCloses(await fetchDailyBars(code, signal, windowDays('w', MA)));
      }
    } else {
      closes = await fetchDailyBoard(code, signal);
    }
    return calcRow({ code: code, name: name }, closes, MA);
  }

  async function ensureDev(code, name) {
    if (state.devs[code]) return state.devs[code];
    if (state.busy) {
      toast('正在计算，请稍候或点计算按钮暂停');
      return null;
    }
    if (!requireKey()) return null;

    state.busy = true;
    state.abort = new AbortController();
    var period = state.boardPeriod;
    var signal = state.abort.signal;
    state.calcCode = code;
    setCalcIndeterminate();
    setCalcBusy(true);
    renderSide();

    try {
      var row = await calcSingleDev(code, name, period, signal);
      if (!row) throw new Error('没有足够的 K 线数据（' + periodLabel(period) + '）');
      state.devs[code] = row;
      saveDev(period, row);
      renderSide();
      return row;
    } catch (e) {
      if (isAbort(e)) return null;
      handleApiError(e);
      toast(e.message, 'err');
      return null;
    } finally {
      state.busy = false;
      state.abort = null;
      state.calcCode = '';
      setCalcBusy(false);
      renderSide();
    }
  }

  async function selectBoard(code, name) {
    if (state.busy) {
      toast('正在计算，请稍候或点计算按钮暂停');
      return;
    }
    state.selected = { code: code, name: name };
    renderSide();

    if (!state.devs[code]) {
      await ensureDev(code, name);
    }
    // 即使偏离度算失败（比如 10jqka 临时 502），右侧个股 / 财务数据也照常加载
    if (state.key) loadRight(code, name);
  }

  async function calcAllBoards() {
    if (!requireKey()) return;
    var period = state.boardPeriod;
    var boards = state.catalog.slice();
    if (!boards.length) {
      toast('板块目录还没载入', 'err');
      return;
    }

    state.busy = true;
    state.abort = new AbortController();
    var signal = state.abort.signal;
    setCalcBusy(true);
    var rows = [];
    var failed = 0;
    var lastError = null;
    var done = 0;
    var total = boards.length;
    setCalcProgress(0, total);

    try {
      if (period === 'd') {
        await mapLimit(chunk(boards, 10), 4, async function (batch) {
          if (signal.aborted) return;
          var byCode = {};
          batch.forEach(function (b) { byCode[b.code] = b; });
          try {
            var data = await thsGet('/api/a-share-index/prices/historical-batch', {
              thscodes: batch.map(function (b) { return b.code + '.TI'; }).join(','),
              interval: '1d',
              start: dayStart(Date.now() - windowDays('d', MA) * 86400000),
              end: dayStart(Date.now()) + 86399999,
            }, { signal: signal, timeout: 30000 });
            (data && data.item ? data.item : []).forEach(function (group) {
              var code = String(group.thscode || '').split('.')[0];
              var closes = (group.item || []).map(function (x) { return num(x.close_price); })
                .filter(function (v) { return isNum(v); });
              var row = calcRow(byCode[code] || { code: code, name: code }, closes, MA);
              if (row) rows.push(row);
            });
          } catch (e) {
            if (isAbort(e)) return;
            lastError = e;
            failed += batch.length;
          } finally {
            done += batch.length;
            setCalcProgress(done, total);
          }
        });
      } else {
        await mapLimit(boards, 4, async function (b) {
          if (signal.aborted) return;
          try {
            var closes = period === '60'
              ? await fetchBoard60(b.code, signal)
              : await fetchBoardWeekly(b.code, signal);
            var row = calcRow(b, closes, MA);
            if (row) rows.push(row);
            else failed += 1;
          } catch (e) {
            if (isAbort(e)) return;
            lastError = e;
            failed += 1;
          } finally {
            done += 1;
            setCalcProgress(done, total);
            if (!signal.aborted) await sleep(60);
          }
        });
      }

      if (signal.aborted) {
        toast('已停止计算');
        return;
      }
      if (!rows.length) {
        throw new Error(lastError
          ? '没有算出有效结果：' + lastError.message
          : '没有算出有效结果（数据不足或取数失败），请稍后重试');
      }

      var map = {};
      rows.forEach(function (r) { map[r.code] = r; });
      state.devs = map;
      state.devTs = Date.now();
      var all = readLS(LS.pool, {});
      all[period] = { ts: Date.now(), rows: rows };
      writeLS(LS.pool, all);
      renderSide();

      if (state.selected && state.tab === 'pool') {
        toast('板块已算完，正在计算「' + (state.selected.name || state.selected.code) + '」全部个股…');
        loadPoolStocks(state.selected.code, state.selected.name, true);
      } else {
        toast('全部板块已计算（' + rows.length + ' 个' +
          (failed ? '，失败 ' + failed + ' 个' : '') + '）');
      }
    } catch (e) {
      if (isAbort(e)) {
        toast('已停止计算');
      } else {
        handleApiError(e);
        toast(e.message, 'err');
      }
    } finally {
      state.busy = false;
      state.abort = null;
      state.calcCode = '';
      setCalcBusy(false);
    }
  }

  async function onCalcClick() {
    if (state.busy) {
      if (state.abort) state.abort.abort();
      return;
    }
    var input = $('stkBoardFilter');
    if (!state.userTyped && input.value) {
      input.value = '';
      state.filter = '';
      renderSide();
    }
    var q = input.value.trim();
    if (!q) {
      await calcAllBoards();
      return;
    }
    var hit = findBoard(q);
    if (!hit) {
      toast('没有找到「' + q + '」相关的行业板块', 'err');
      return;
    }
    if (state.devs[hit.code]) {
      toast('该板块已计算');
      await selectBoard(hit.code, hit.name);
      return;
    }
    await selectBoard(hit.code, hit.name);
  }

  /* ------------------------------------------------------------------ */
  /* 板块内个股                                                         */
  /* ------------------------------------------------------------------ */

  async function fetchTxQuotes(codes, opts) {
    opts = opts || {};
    var out = {};
    if (!codes.length) return out;
    var batches = chunk(codes, 50);
    await mapLimit(batches, 2, async function (batch) {
      var syms = batch.map(txSymbol).join(',');
      var text = await fetchText(TX_QUOTE + syms, {
        signal: opts.signal,
        timeout: 15000,
        retries: 1,
        encoding: 'gbk',
      });
      text.split(';').forEach(function (seg) {
        var at = seg.indexOf('="');
        if (at < 0) return;
        var body = seg.slice(at + 2).replace(/"\s*$/, '');
        var f = body.split('~');
        if (f.length < 53) return;
        var code = String(f[2] || '').trim();
        if (!code) return;
        var cap = num(f[45]);
        var fcap = num(f[44]);
        out[code] = {
          price: num(f[3]),
          chg: num(f[32]),
          pe: num(f[52]) !== null ? num(f[52]) : num(f[39]),
          cap: isNum(cap) ? cap * 1e8 : null,
          float_cap: isNum(fcap) ? fcap * 1e8 : null,
        };
      });
    });
    return out;
  }

  async function fetchTx60(code, opts) {
    opts = opts || {};
    var sym = txSymbol(code);
    var url = TX_MIN + '?param=' + sym + ',m60,,320';
    var j = await fetchJson(url, {
      signal: opts.signal,
      timeout: 15000,
      retries: 1,
    });
    var data = j && j.data ? j.data[sym] : null;
    var bars = data && data.m60 ? data.m60 : [];
    return bars.map(function (b) { return num(b[2]); }).filter(function (v) { return isNum(v); });
  }

  async function mapLimit(items, limit, fn) {
    var next = 0;
    var count = Math.max(1, Math.min(limit, items.length));
    var workers = [];
    for (var w = 0; w < count; w++) {
      workers.push((async function () {
        while (true) {
          var i = next++;
          if (i >= items.length) return;
          await fn(items[i], i);
        }
      })());
    }
    await Promise.all(workers);
  }

  function readStockCache(code, period) {
    var all = readLS(LS.stock, {});
    var ent = all[code + ':' + period];
    if (!ent || !Array.isArray(ent.rows) || !ent.rows.length) return null;
    return ent;
  }

  function writeStockCache(code, period, rows) {
    var all = readLS(LS.stock, {});
    all[code + ':' + period] = { ts: Date.now(), rows: rows };
    var keys = Object.keys(all).sort(function (a, b) { return (all[b].ts || 0) - (all[a].ts || 0); });
    keys.slice(30).forEach(function (k) { delete all[k]; });
    writeLS(LS.stock, all);
  }

  function paintStockSelection(tab) {
    var body = tab === 'pool' ? $('stkStockBody') : $('stkCompareBody');
    if (!body) return;
    var code = state.stockSel[tab] || '';
    $$('tr', body).forEach(function (tr) {
      tr.classList.toggle('is-stock-selected', !!code && tr.dataset.code === code);
    });
  }

  function selectStockRow(tab, code) {
    if (!tab) tab = state.tab;
    state.stockSel[tab] = String(code || '');
    paintStockSelection(tab);
  }

  function renderPoolStocks() {
    var tbody = $('stkStockBody');
    if (!tbody) return;
    var rows = state.pool.rows.slice();
    var sort = state.pool.sort || { col: 'dev', desc: true };
    if (sort.col) {
      rows.sort(function (a, b) {
        if (sort.col === 'code' || sort.col === 'name') {
          var sa = String(a[sort.col] || '');
          var sb = String(b[sort.col] || '');
          return sort.desc ? sb.localeCompare(sa, 'zh-CN') : sa.localeCompare(sb, 'zh-CN');
        }
        var va = isNum(a[sort.col]) ? a[sort.col] : null;
        var vb = isNum(b[sort.col]) ? b[sort.col] : null;
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return sort.desc ? vb - va : va - vb;
      });
    }
    tbody.innerHTML = rows.map(function (r) {
      var cls = trendClass(r.dev);
      var chgCls = trendClass(r.chg);
      var selected = state.stockSel.pool === String(r.code);
      return '<tr' + (selected ? ' class="is-stock-selected"' : '') +
        ' data-code="' + esc(r.code) + '" data-name="' + esc(r.name) + '" title="单击选中，双击查看走势">' +
        '<td class="stk-code">' + esc(r.code) + '</td>' +
        '<td class="stk-name" title="' + esc(r.name || r.code) + '">' + esc(r.name || r.code) + '</td>' +
        '<td class="is-num">' + fmtPrice(r.price) + '</td>' +
        '<td class="is-num ' + chgCls + '">' + fmtSignedPct(r.chg) + '</td>' +
        '<td class="is-num">' + fmtNum(r.ma, 2) + '</td>' +
        '<td class="is-num ' + cls + '">' + fmtSignedPct(r.dev) + '</td>' +
        '<td class="is-num">' + fmtMoney(r.float_cap) + '</td>' +
        '</tr>';
    }).join('');
    setEmpty('stkStockEmpty', rows.length === 0,
      state.selected ? '这个板块暂时没有可用的个股数据' : '点左侧板块查看个股偏离度');
    markSort('#stkStockWrap th.is-sortable', sort.col, sort.desc);
  }

  async function loadPoolStocks(code, name, force) {
    if (!requireKey()) return;
    var period = state.stockPeriod;
    var token = ++state.pool.token;
    if (state.pool.code !== code) state.stockSel.pool = '';
    state.pool.code = code;
    state.pool.period = period;
    state.pool.rows = [];
    state.pool.ts = 0;
    state.pool.loading = true;
    $('stkStockBody').innerHTML = '';
    setEmpty('stkStockEmpty', true, '加载中…');
    setWrapLoading('stkStockWrap', true);

    var cached = readStockCache(code, period);
    if (cached && !force && Date.now() - cached.ts <= STOCK_TTL) {
      state.pool.rows = cached.rows;
      state.pool.ts = cached.ts;
      state.pool.loading = false;
      setWrapLoading('stkStockWrap', false);
      renderPoolStocks();
      return;
    }

    try {
      var cons = await thsGet('/api/a-share-index/constituents/ths-stock-list',
        { thscode: code + '.TI' }, { timeout: 20000 });
      var members = (cons && cons.item ? cons.item : [])
        .filter(function (x) { return /^\d{6}$/.test(String(x.ticker || '')); })
        .map(function (x) { return { code: String(x.ticker), name: String(x.name || x.ticker) }; });
      if (!members.length) throw new Error('该板块没有成分股');
      if (token !== state.pool.token) return;

      var quotes = {};
      try {
        quotes = await fetchTxQuotes(members.map(function (m) { return m.code; }), {});
      } catch (e) {
        if (isAbort(e)) throw e;
      }

      var closesMap = {};
      if (period === '60') {
        await mapLimit(members, 6, async function (m) {
          try {
            var closes = await fetchTx60(m.code, {});
            if (closes.length >= MA) closesMap[m.code] = closes;
          } catch (e) {
            if (isAbort(e)) throw e;
          }
        });
      } else {
        var interval = period === 'w' ? '1w' : '1d';
        await mapLimit(chunk(members, 10), 4, async function (batch) {
          try {
            var data = await thsGet('/api/a-share/prices/historical-batch', {
              thscodes: batch.map(function (m) { return secuCode(m.code); }).join(','),
              interval: interval,
              start: dayStart(Date.now() - windowDays(period, MA) * 86400000),
              end: dayStart(Date.now()) + 86399999,
              adjust: 'forward',
            }, { timeout: 30000 });
            (data && data.item ? data.item : []).forEach(function (group) {
              var c = String(group.thscode || '').split('.')[0];
              var closes = (group.item || []).map(function (x) { return num(x.close_price); })
                .filter(function (v) { return isNum(v); });
              if (closes.length >= MA) closesMap[c] = closes;
            });
          } catch (e) {
            if (isAbort(e)) throw e;
          }
        });
      }

      if (token !== state.pool.token) return;

      var rows = [];
      members.forEach(function (m) {
        var closes = closesMap[m.code];
        if (!closes || closes.length < MA) return;
        var last = closes[closes.length - 1];
        var avg = mean(closes.slice(-MA));
        if (!(avg > 0)) return;
        var q = quotes[m.code] || {};
        rows.push({
          code: m.code,
          name: m.name,
          price: isNum(q.price) ? q.price : last,
          chg: isNum(q.chg) ? q.chg : null,
          ma: avg,
          dev: (last / avg - 1) * 100,
          float_cap: isNum(q.float_cap) ? q.float_cap : null,
        });
      });
      rows.sort(function (a, b) { return b.dev - a.dev; });
      state.pool.rows = rows;
      state.pool.ts = Date.now();
      state.pool.loading = false;
      writeStockCache(code, period, rows);
      setWrapLoading('stkStockWrap', false);
      renderPoolStocks();
    } catch (e) {
      if (token !== state.pool.token) return;
      handleApiError(e);
      state.pool.loading = false;
      setWrapLoading('stkStockWrap', false);
      setEmpty('stkStockEmpty', true, '加载失败，点板块 / 偏离中间的刷新按钮重试');
      toast(e.message, 'err');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 比价关系                                                           */
  /* ------------------------------------------------------------------ */

  async function emQuery(reportName, columns, filter, opts) {
    opts = opts || {};
    var base = new URL(EM_BASE);
    base.searchParams.set('reportName', reportName);
    base.searchParams.set('columns', columns);
    base.searchParams.set('filter', filter);
    base.searchParams.set('pageSize', opts.pageSize || '500');
    base.searchParams.set('source', 'HSF10');
    base.searchParams.set('client', 'PC');
    base.searchParams.set('type', '0');
    if (opts.sortColumns) {
      base.searchParams.set('sortColumns', opts.sortColumns);
      base.searchParams.set('sortTypes', opts.sortTypes || '-1');
    }

    var out = [];
    var page = 1;
    var pages = 1;
    do {
      base.searchParams.set('pageNumber', String(page));
      var j = await fetchJson(base.toString(), {
        signal: opts.signal,
        timeout: 15000,
        retries: 0,
      });
      var result = j && j.result;
      var data = result && Array.isArray(result.data) ? result.data : [];
      out = out.concat(data);
      pages = result && Number(result.pages) ? Number(result.pages) : 1;
      page += 1;
    } while (opts.allPages && page <= pages && page <= 6);
    return out;
  }

  async function fetchFinance(codes, opts) {
    opts = opts || {};
    var out = {};
    if (!codes.length) return out;
    await mapLimit(chunk(codes, 50), 3, async function (batch) {
      var flt = '(SECUCODE in (' + batch.map(function (c) { return '"' + secuCode(c) + '"'; }).join(',') + '))';
      try {
        var rows = await emQuery(
          'RPT_F10_FINANCE_MAINFINADATA',
          'SECUCODE,REPORT_DATE,REPORT_TYPE,ORG_TYPE,ROEJQ,TOTAL_ASSETS_PK,PARENTNETPROFIT,NETCASH_OPERATE_PK,OPERATE_INCOME_PK,TOTAL_EQUITY_PK,LIABILITY',
          flt,
          { signal: opts.signal, pageSize: '500', allPages: true }
        );
        var byCode = {};
        rows.forEach(function (r) {
          var code = String(r.SECUCODE || '').split('.')[0];
          if (!code) return;
          (byCode[code] || (byCode[code] = [])).push(r);
        });
        Object.keys(byCode).forEach(function (code) {
          var list = byCode[code].slice().sort(function (a, b) {
            return String(b.REPORT_DATE || '').localeCompare(String(a.REPORT_DATE || ''));
          });
          var annual = list.filter(function (x) { return x.REPORT_TYPE === '年报'; })[0];
          out[code] = annual || list[0];
        });
      } catch (e) {
        if (isAbort(e)) throw e;
      }
    });
    return out;
  }

  async function fetchDividends(codes, opts) {
    opts = opts || {};
    var out = {};
    if (!codes.length) return out;
    var cutoff = Date.now() - 365 * 86400000;
    await mapLimit(chunk(codes, 50), 3, async function (batch) {
      var flt = '(SECUCODE in (' + batch.map(function (c) { return '"' + secuCode(c) + '"'; }).join(',') +
        '))(ASSIGN_PROGRESS="实施分配")';
      try {
        var rows = await emQuery(
          'RPT_SHAREBONUS_DET',
          'SECUCODE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB',
          flt,
          { signal: opts.signal, pageSize: '500', allPages: true, sortColumns: 'EX_DIVIDEND_DATE', sortTypes: '-1' }
        );
        rows.forEach(function (r) {
          var code = String(r.SECUCODE || '').split('.')[0];
          var ex = String(r.EX_DIVIDEND_DATE || '').slice(0, 10);
          var per10 = num(r.PRETAX_BONUS_RMB);
          if (!code || !ex || per10 === null) return;
          var t = Date.parse(ex + 'T00:00:00+08:00');
          if (!isFinite(t) || t < cutoff) return;
          out[code] = (out[code] || 0) + per10 / 10;
        });
      } catch (e) {
        if (isAbort(e)) throw e;
      }
    });
    return out;
  }

  function computeFinance(x, q, dps) {
    var profit = x ? num(x.PARENTNETPROFIT) : null;
    var revenue = x ? num(x.OPERATE_INCOME_PK) : null;
    var assets = x ? num(x.TOTAL_ASSETS_PK) : null;
    var equity = x ? num(x.TOTAL_EQUITY_PK) : null;
    var liability = x ? num(x.LIABILITY) : null;
    var ocf = x ? num(x.NETCASH_OPERATE_PK) : null;

    function ratio(a, b, pct) {
      if (!isNum(a) || !isNum(b) || b <= 0) return null;
      return (a / b) * (pct ? 100 : 1);
    }

    var roe = ratio(profit, equity, true);
    if (roe === null && x) roe = num(x.ROEJQ);

    var price = q ? q.price : null;
    var cap = q ? q.cap : null;
    var peStatic = null;
    if (isNum(cap) && isNum(profit)) peStatic = profit > 0 ? cap / profit : -1;

    return {
      roe: roe,
      net_margin: ratio(profit, revenue, true),
      asset_turnover: ratio(revenue, assets, false),
      equity_multiplier: ratio(assets, equity, false),
      ocf: ocf,
      liability: liability,
      debt_coverage: ratio(ocf, liability, true),
      dividend_yield: isNum(dps) && isNum(price) && price > 0 ? dps / price * 100 : null,
      pe: q && isNum(q.pe) ? q.pe : null,
      pe_static: peStatic,
    };
  }

  function txTimeMs(s) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  }

  async function fetchTx60Bars(code, opts) {
    opts = opts || {};
    var sym = txSymbol(code);
    var j = await fetchJson(TX_MIN + '?param=' + sym + ',m60,,320', {
      signal: opts.signal,
      timeout: 15000,
      retries: 2,
    });
    var data = j && j.data ? j.data[sym] : null;
    var rows = data && data.m60 ? data.m60 : [];
    return rows.map(function (p) {
      var t = txTimeMs(p[0]);
      return {
        t: t,
        o: num(p[1]),
        c: num(p[2]),
        h: num(p[3]),
        l: num(p[4]),
        v: num(p[5]) || 0,
        amt: num(p[6]) || 0,
      };
    }).filter(function (b) {
      return isNum(b.t) && isNum(b.o) && isNum(b.c) && isNum(b.h) && isNum(b.l);
    });
  }

  async function fetchStockBars(code, period) {
    if (period === '60') return fetchTx60Bars(code, {});
    var interval = period === 'w' ? '1w' : '1d';
    var days = period === 'w' ? 6 * 365 : 2 * 365;
    var data = await thsGet('/api/a-share/prices/historical-batch', {
      thscodes: secuCode(code),
      interval: interval,
      start: dayStart(Date.now() - days * 86400000),
      end: dayStart(Date.now()) + 86399999,
      adjust: 'none',
    }, { timeout: 30000 });
    var group = (data && data.item ? data.item : [])[0];
    if (!group) return [];
    return (group.item || []).map(function (x) {
      return {
        t: num(x.date_ms),
        o: num(x.open_price),
        c: num(x.close_price),
        h: num(x.high_price),
        l: num(x.low_price),
        v: num(x.volume) || 0,
        amt: num(x.turnover) || 0,
      };
    }).filter(function (b) {
      return isNum(b.t) && isNum(b.o) && isNum(b.c) && isNum(b.h) && isNum(b.l);
    });
  }

  async function fetchDividendYears(code) {
    var out = {};
    try {
      var rows = await emQuery(
        'RPT_SHAREBONUS_DET',
        'REPORT_DATE,EX_DIVIDEND_DATE,DIVIDENT_RATIO',
        '(SECUCODE="' + secuCode(code) + '")(ASSIGN_PROGRESS="实施分配")',
        { pageSize: '100', allPages: true }
      );
      var best = {};
      rows.forEach(function (x) {
        var rd = String(x.REPORT_DATE || '').slice(0, 10);
        var v = num(x.DIVIDENT_RATIO);
        if (!rd || v === null) return;
        var ex = String(x.EX_DIVIDEND_DATE || '');
        if (!best[rd] || ex > best[rd][0]) best[rd] = [ex, v];
      });
      Object.keys(best).forEach(function (rd) {
        var y = rd.slice(0, 4);
        out[y] = (out[y] || 0) + best[rd][1] * 100;
      });
    } catch (e) {
      /* 分红取不到不影响财务表 */
    }
    return out;
  }

  function computeAnnualMetrics(x, divYield) {
    var profit = x ? num(x.PARENTNETPROFIT) : null;
    var revenue = x ? num(x.OPERATE_INCOME_PK) : null;
    var assets = x ? num(x.TOTAL_ASSETS_PK) : null;
    var equity = x ? num(x.TOTAL_EQUITY_PK) : null;
    var liability = x ? num(x.LIABILITY) : null;
    var ocf = x ? num(x.NETCASH_OPERATE_PK) : null;

    function ratio(a, b, pct) {
      if (!isNum(a) || !isNum(b) || b <= 0) return null;
      return (a / b) * (pct ? 100 : 1);
    }

    var roe = ratio(profit, equity, true);
    if (roe === null && x) roe = num(x.ROEJQ);
    return {
      roe: roe,
      net_margin: ratio(profit, revenue, true),
      asset_turnover: ratio(revenue, assets, false),
      equity_multiplier: ratio(assets, equity, false),
      ocf: ocf,
      liability: liability,
      debt_coverage: ratio(ocf, liability, true),
      dividend_yield: isNum(divYield) ? divYield : null,
    };
  }

  async function fetchFinanceHistory(code, years) {
    var rows = await emQuery(
      'RPT_F10_FINANCE_MAINFINADATA',
      'SECUCODE,REPORT_DATE,REPORT_TYPE,ORG_TYPE,ROEJQ,TOTAL_ASSETS_PK,PARENTNETPROFIT,NETCASH_OPERATE_PK,OPERATE_INCOME_PK,TOTAL_EQUITY_PK,LIABILITY',
      '(SECUCODE="' + secuCode(code) + '")',
      { pageSize: '100', allPages: true }
    );
    var annual = rows.filter(function (x) { return x.REPORT_TYPE === '年报'; });
    annual.sort(function (a, b) {
      return String(b.REPORT_DATE || '').localeCompare(String(a.REPORT_DATE || ''));
    });
    var byYear = {};
    annual.forEach(function (x) {
      var y = String(x.REPORT_DATE || '').slice(0, 4);
      if (/^\d{4}$/.test(y) && !byYear[y]) byYear[y] = x;
    });
    var list = Object.keys(byYear).sort().reverse().slice(0, years || 5);
    var divs = await fetchDividendYears(code);
    return list.map(function (y) {
      var m = computeAnnualMetrics(byYear[y], divs[y]);
      m.year = y;
      return m;
    });
  }

  function renderDetailFin(rows) {
    var host = $('stkDetailFin');
    if (!host) return;
    if (!rows || !rows.length) {
      host.innerHTML = '<div class="stk-detail__note">没有获取到最近 5 年年报数据（接口繁忙或新上市）</div>';
      return;
    }
    var defs = [
      ['ROE', 'roe', 'pct'],
      ['净利率', 'net_margin', 'pct'],
      ['总资产周转率', 'asset_turnover', 'turn'],
      ['权益乘数', 'equity_multiplier', 'mult'],
      ['经营现金流净额', 'ocf', 'money'],
      ['总负债', 'liability', 'money'],
      ['保障率', 'debt_coverage', 'pct'],
      ['股息率', 'dividend_yield', 'pct'],
    ];
    var fmt = {
      pct: function (v) { return isNum(v) ? fmtPct(v) : '—'; },
      money: function (v) { return isNum(v) ? fmtMoney(v) : '—'; },
      turn: function (v) { return isNum(v) ? fmtNum(v, 4) : '—'; },
      mult: function (v) { return isNum(v) ? fmtNum(v, 3) : '—'; },
    };
    var html = '<table class="stk-detail-table"><thead><tr><th>指标</th>' +
      rows.map(function (r) { return '<th>' + esc(r.year) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    defs.forEach(function (d) {
      html += '<tr><td>' + d[0] + '</td>' +
        rows.map(function (r) { return '<td>' + fmt[d[2]](r[d[1]]) + '</td>'; }).join('') +
        '</tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
  }

  function setDetailChartState(text, isErr) {
    var el = $('stkDetailChartState');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-err', !!isErr);
    el.hidden = !text;
  }

  function openStockDetail(code, name, withFin) {
    var d = state.detail;
    code = String(code || '');
    if (!code) return;
    var showFin = withFin !== false;
    d.code = code;
    d.name = name || code;
    d.period = '60';
    d.bars = [];
    d.hover = -1;
    d.geom = null;
    d.showFin = showFin;
    d.token += 1;
    d.finToken += 1;

    $('stkDetailTitle').textContent = d.name + '  ' + code;
    $('stkDetailSub').textContent = '1 小时 · 不复权';
    $$('#stkDetailPeriods button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.period === '60');
    });
    $('stkDetailFinWrap').hidden = !showFin;
    var card = document.querySelector('.stk-detail__card');
    if (card) card.classList.toggle('is-chart-only', !showFin);
    if (showFin) $('stkDetailFin').innerHTML = '<div class="stk-detail__note">加载中…</div>';
    else $('stkDetailFin').innerHTML = '';
    setDetailChartState('加载中…');

    var cv = $('stkDetailChart');
    if (cv) {
      var ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
    }
    $('stkDetailModal').hidden = false;
    selectStockRow(state.tab, code);
    closeCompareMenu();
    closePeriodMenus();
    loadDetailChart('60');
    if (showFin) loadDetailFin(code);
  }

  function closeStockDetail() {
    var modal = $('stkDetailModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    state.detail.token += 1;
    state.detail.finToken += 1;
    state.detail.bars = [];
    state.detail.hover = -1;
    state.detail.geom = null;
  }

  async function loadDetailChart(period) {
    var d = state.detail;
    var my = ++d.token;
    d.period = period;
    d.hover = -1;
    setDetailChartState('加载中…');
    try {
      var bars = await fetchStockBars(d.code, period);
      if (my !== d.token || $('stkDetailModal').hidden) return;
      if (!bars.length) throw new Error('没有取到 K 线数据');
      d.bars = bars;
      d.geom = null;
      setDetailChartState('');
      drawDetailChart();
    } catch (e) {
      if (my !== d.token) return;
      d.bars = [];
      setDetailChartState('走势图加载失败：' + e.message, true);
    }
  }

  async function loadDetailFin(code) {
    var d = state.detail;
    var my = ++d.finToken;
    try {
      var rows = await fetchFinanceHistory(code, 5);
      if (my !== d.finToken || $('stkDetailModal').hidden) return;
      renderDetailFin(rows);
    } catch (e) {
      if (my !== d.finToken) return;
      $('stkDetailFin').innerHTML = '<div class="stk-detail__note">五年数据加载失败：' + esc(e.message) + '</div>';
    }
  }

  function setDetailPeriod(period) {
    var d = state.detail;
    if (d.period === period || !d.code) return;
    d.period = period;
    $('stkDetailSub').textContent = period === '60' ? '1 小时 · 不复权'
      : (period === 'd' ? '日线 · 不复权' : '周线 · 不复权');
    $$('#stkDetailPeriods button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.period === period);
    });
    loadDetailChart(period);
  }

  function maSeries(closes, n) {
    var out = new Array(closes.length);
    var sum = 0;
    for (var i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= n) sum -= closes[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function fmtBarTime(t, period) {
    var d = new Date(t);
    var p2 = function (v) { return String(v).padStart(2, '0'); };
    if (period === '60') {
      return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function drawDetailChart() {
    var d = state.detail;
    var cv = $('stkDetailChart');
    if (!cv || !d.bars.length) return;
    var W = Math.max(cv.clientWidth, 320);
    var H = Math.max(cv.clientHeight, 220);
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var all = d.bars;
    var maxBars = d.period === '60' ? 320 : (d.period === 'd' ? 240 : 260);
    var start = Math.max(0, all.length - maxBars);
    var view = all.slice(start);
    var n = view.length;
    if (n < 2) return;

    var UP = '#ad3535', DOWN = '#2f7a4f';
    var GRID = 'rgba(36,31,22,0.09)', AXIS = '#8a8270';
    var MA_COLORS = { 5: '#e8912d', 10: '#3565d6', 250: '#8a94a6' };
    var maSpecs = [5, 10, 250];
    var closes = all.map(function (b) { return b.c; });
    var maAll = {};
    maSpecs.forEach(function (k) { maAll[k] = maSeries(closes, k).slice(start); });

    var left = 10, right = W - 56, top = 28, bottom = H - 20;
    var volH = Math.min(54, Math.max(34, H * 0.15));
    var volBottom = bottom;
    var volTop = volBottom - volH;
    var priceBottom = volTop - 12;
    var priceTop = top;

    var lo = Infinity, hi = -Infinity;
    view.forEach(function (b) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    maSpecs.forEach(function (k) {
      maAll[k].forEach(function (v) {
        if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      });
    });
    var pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    var span = hi - lo || 1;
    var plotW = right - left;
    var barW = plotW / n;

    function X(i) { return left + (i + 0.5) * barW; }
    function Y(p) { return priceTop + (hi - p) / span * (priceBottom - priceTop); }

    ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var price = lo + span * g / 4;
      var y = Y(price);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillStyle = AXIS;
      ctx.textAlign = 'left';
      ctx.fillText(price.toFixed(2), right + 6, y + 3.5);
    }

    var vmax = 1;
    view.forEach(function (b) { if (isNum(b.v)) vmax = Math.max(vmax, b.v); });
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(left, volTop - 6);
    ctx.lineTo(right, volTop - 6);
    ctx.stroke();

    var cw = Math.max(1, Math.min(9, barW * 0.62));
    view.forEach(function (b, i) {
      var up = b.c >= b.o;
      var col = up ? UP : DOWN;
      var x = X(i);
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, Y(b.h));
      ctx.lineTo(x, Y(b.l));
      ctx.stroke();
      var y1 = Y(Math.max(b.o, b.c));
      var y2 = Y(Math.min(b.o, b.c));
      if (y2 - y1 < 1) y2 = y1 + 1;
      ctx.fillStyle = col;
      ctx.fillRect(x - cw / 2, y1, cw, y2 - y1);
      if (isNum(b.v)) {
        var vh = (b.v / vmax) * (volBottom - volTop);
        ctx.fillStyle = up ? 'rgba(173,53,53,0.55)' : 'rgba(47,122,79,0.55)';
        ctx.fillRect(x - cw / 2, volBottom - vh, cw, vh);
      }
    });

    maSpecs.forEach(function (k) {
      var vals = maAll[k];
      ctx.strokeStyle = MA_COLORS[k];
      ctx.lineWidth = 1;
      ctx.beginPath();
      var started = false;
      for (var i = 0; i < vals.length; i++) {
        if (!isNum(vals[i])) continue;
        var x = X(i), y = Y(vals[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      if (started) ctx.stroke();
    });

    var last = view[n - 1];
    var prev = n > 1 ? view[n - 2] : last;
    var chg = prev.c ? (last.c / prev.c - 1) * 100 : 0;
    ctx.textAlign = 'left';
    ctx.font = '600 12px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif';
    ctx.fillStyle = chg >= 0 ? UP : DOWN;
    var head = '收 ' + fmtPrice(last.c) + '  ' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    ctx.fillText(head, left, 15);
    ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif';
    var lx = left + ctx.measureText(head).width + 16;
    maSpecs.forEach(function (k) {
      var v = maAll[k][n - 1];
      var txt = 'MA' + k + ' ' + (isNum(v) ? v.toFixed(2) : '—');
      ctx.fillStyle = MA_COLORS[k];
      ctx.fillText(txt, lx, 15);
      lx += ctx.measureText(txt).width + 10;
    });

    var steps = Math.min(5, n - 1);
    ctx.fillStyle = AXIS;
    ctx.font = '10.5px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif';
    for (var s = 0; s <= steps; s++) {
      var idx = Math.round((n - 1) * s / Math.max(1, steps));
      var label = fmtBarTime(view[idx].t, d.period);
      var tx = X(idx);
      ctx.textAlign = s === 0 ? 'left' : (s === steps ? 'right' : 'center');
      ctx.fillText(label, tx, H - 5);
    }

    d.geom = { left: left, right: right, top: priceTop, bottom: priceBottom, volTop: volTop, volBottom: volBottom, barW: barW, start: start, view: view };

    if (d.hover >= 0 && d.hover < n) {
      var i = d.hover;
      var b = view[i];
      var hx = X(i);
      ctx.strokeStyle = 'rgba(36,31,22,0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, priceTop);
      ctx.lineTo(hx, volBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      var txt = fmtBarTime(b.t, d.period) + '  开 ' + fmtPrice(b.o) +
        '  高 ' + fmtPrice(b.h) + '  低 ' + fmtPrice(b.l) +
        '  收 ' + fmtPrice(b.c);
      ctx.font = '11px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif';
      var tw = ctx.measureText(txt).width + 16;
      var bx = Math.max(left + 4, Math.min(hx - tw / 2, right - tw - 4));
      ctx.fillStyle = 'rgba(36,31,22,0.86)';
      ctx.fillRect(bx, priceTop + 4, tw, 21);
      ctx.fillStyle = '#f6efdf';
      ctx.textAlign = 'left';
      ctx.fillText(txt, bx + 8, priceTop + 18);
    }
  }

  function readCompareCache(code) {
    var all = readLS(LS.board, {});
    var ent = all[code];
    if (!ent || !Array.isArray(ent.rows) || !ent.rows.length) return null;
    return ent;
  }

  function writeCompareCache(code, rows) {
    var all = readLS(LS.board, {});
    all[code] = { ts: Date.now(), rows: rows };
    var keys = Object.keys(all).sort(function (a, b) { return (all[b].ts || 0) - (all[a].ts || 0); });
    keys.slice(24).forEach(function (k) { delete all[k]; });
    writeLS(LS.board, all);
  }

  function isPinned(code) {
    return state.pinned.indexOf(String(code)) >= 0;
  }

  function isBottom(code) {
    return state.bottom.indexOf(String(code)) >= 0;
  }

  function normalizeCodes(stored) {
    if (!Array.isArray(stored)) return [];
    var seen = {};
    return stored.map(function (c) { return String(c); }).filter(function (c) {
      if (!c || seen[c]) return false;
      seen[c] = 1;
      return true;
    });
  }

  function savePinned() {
    writeLS(LS.pinned, state.pinned.slice());
  }

  function saveBottom() {
    writeLS(LS.bottom, state.bottom.slice());
  }

  function loadPinned() {
    state.pinned = normalizeCodes(readLS(LS.pinned, []));
    state.bottom = normalizeCodes(readLS(LS.bottom, [])).filter(function (c) {
      return state.pinned.indexOf(c) < 0;
    });
  }

  function renderCompareRows() {
    var tbody = $('stkCompareBody');
    if (!tbody) return;
    var rows = state.compare.rows.slice();
    var sort = state.compare.sort || { col: null, desc: false };

    function cmp(a, b) {
      if (sort.col === 'name' || sort.col === 'code') {
        var sa = String(a[sort.col] || '');
        var sb = String(b[sort.col] || '');
        return sort.desc ? sb.localeCompare(sa, 'zh-CN') : sa.localeCompare(sb, 'zh-CN');
      }
      var va = isNum(a[sort.col]) ? a[sort.col] : null;
      var vb = isNum(b[sort.col]) ? b[sort.col] : null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      var aBad = (sort.col === 'pe' || sort.col === 'pe_static') && va <= 0;
      var bBad = (sort.col === 'pe' || sort.col === 'pe_static') && vb <= 0;
      if (aBad !== bBad) return aBad ? 1 : -1;
      return sort.desc ? vb - va : va - vb;
    }

    var pinnedRows = [];
    var normalRows = [];
    var bottomRows = [];
    var bottomOrder = {};
    state.bottom.forEach(function (c, i) { bottomOrder[c] = i; });
    rows.forEach(function (r) {
      if (isPinned(r.code)) pinnedRows.push(r);
      else if (isBottom(r.code)) bottomRows.push(r);
      else normalRows.push(r);
    });
    if (sort.col) {
      pinnedRows.sort(cmp);
      normalRows.sort(cmp);
    }
    bottomRows.sort(function (a, b) {
      return (bottomOrder[String(a.code)] || 0) - (bottomOrder[String(b.code)] || 0);
    });
    rows = pinnedRows.concat(normalRows, bottomRows);

    tbody.innerHTML = rows.map(function (r) {
      var pinned = isPinned(r.code);
      var bottom = isBottom(r.code);
      var mark = pinned
        ? '<span class="stk-pinmark" title="已置顶">顶</span>'
        : (bottom ? '<span class="stk-pinmark stk-pinmark--bottom" title="已移到底部">底</span>' : '');
      var selected = state.stockSel.compare === String(r.code);
      var rowClass = [
        pinned ? 'is-pinned' : '',
        bottom ? 'is-bottomed' : '',
        selected ? 'is-stock-selected' : '',
      ].filter(Boolean).join(' ');
      return '<tr class="' + rowClass + '" data-code="' + esc(r.code) + '" data-name="' + esc(r.name || r.code) + '" title="单击选中，右键置顶/移到底部，双击查看走势">' +
        '<td class="stk-name" title="' + esc(r.name || r.code) + '">' + mark + esc(r.name || r.code) + '</td>' +
        '<td class="stk-code">' + esc(r.code) + '</td>' +
        '<td class="is-num">' + fmtMoney(r.float_cap) + '</td>' +
        '<td class="is-num">' + fmtPct(r.roe) + '</td>' +
        '<td class="is-num">' + fmtPct(r.net_margin) + '</td>' +
        '<td class="is-num">' + fmtNum(r.asset_turnover, 4) + '</td>' +
        '<td class="is-num">' + fmtNum(r.equity_multiplier, 3) + '</td>' +
        '<td class="is-num">' + fmtMoney(r.ocf) + '</td>' +
        '<td class="is-num">' + fmtMoney(r.liability) + '</td>' +
        '<td class="is-num">' + fmtPct(r.debt_coverage) + '</td>' +
        '<td class="is-num">' + fmtPct(r.dividend_yield) + '</td>' +
        '<td class="is-num">' + fmtPE(r.pe) + '</td>' +
        '<td class="is-num">' + fmtPE(r.pe_static) + '</td>' +
        '</tr>';
    }).join('');
    setEmpty('stkCompareEmpty', rows.length === 0,
      state.selected ? '该板块暂无数据' : '点左侧板块查看当前数据');
    markSort('#stkCompareWrap th.is-sortable', sort.col, sort.desc);
  }

  function closeCompareMenu() {
    var menu = $('stkCompareMenu');
    if (menu) menu.hidden = true;
    state.ctxCode = '';
  }

  function openCompareMenu(code, x, y) {
    var menu = $('stkCompareMenu');
    if (!menu) return;
    var row = null;
    for (var i = 0; i < state.compare.rows.length; i++) {
      if (String(state.compare.rows[i].code) === String(code)) { row = state.compare.rows[i]; break; }
    }
    state.ctxCode = code;
    var title = $('stkCompareMenuTitle');
    if (title) title.textContent = row ? ((row.name || code) + ' · ' + code) : code;
    var pinned = isPinned(code);
    var bottom = isBottom(code);
    var pinBtn = $('stkComparePin');
    var unpinBtn = $('stkCompareUnpin');
    var bottomBtn = $('stkCompareBottom');
    var restoreBtn = $('stkCompareRestore');
    if (pinBtn) {
      pinBtn.textContent = pinned ? '已置顶' : '置顶';
      pinBtn.disabled = pinned;
      pinBtn.title = pinned ? '已经在置顶组' : '放到置顶组最上方';
    }
    if (unpinBtn) {
      unpinBtn.disabled = !pinned;
      unpinBtn.title = pinned ? '取消置顶，回到普通组' : '当前没有置顶';
    }
    if (bottomBtn) {
      bottomBtn.disabled = bottom;
      bottomBtn.title = bottom ? '已经在底部组' : '放到列表最底部';
    }
    if (restoreBtn) {
      restoreBtn.disabled = !bottom;
      restoreBtn.title = bottom ? '从底部组移回普通组' : '当前不在底部组';
    }

    menu.hidden = false;
    menu.style.left = '0px';
    menu.style.top = '0px';
    var rect = menu.getBoundingClientRect();
    var left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    var top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function withoutCode(list, code) {
    return list.filter(function (c) { return c !== code; });
  }

  function pinStock(code) {
    code = String(code);
    state.bottom = withoutCode(state.bottom, code);
    if (state.pinned.indexOf(code) < 0) state.pinned.push(code);
    savePinned();
    saveBottom();
    renderCompareRows();
    toast('已置顶');
  }

  function unpinStock(code) {
    code = String(code);
    state.pinned = withoutCode(state.pinned, code);
    savePinned();
    renderCompareRows();
    toast('已取消置顶');
  }

  function bottomStock(code) {
    code = String(code);
    state.pinned = withoutCode(state.pinned, code);
    state.bottom = withoutCode(state.bottom, code);
    state.bottom.push(code);
    savePinned();
    saveBottom();
    renderCompareRows();
    toast('已移到底部');
  }

  function restoreStock(code) {
    code = String(code);
    state.bottom = withoutCode(state.bottom, code);
    saveBottom();
    renderCompareRows();
    toast('已移回上方');
  }

  async function loadCompare(code, name, force) {
    if (!requireKey()) return;
    closeCompareMenu();
    var token = ++state.compare.token;
    var sameCode = state.compare.code === code;
    if (!sameCode) {
      state.stockSel.compare = '';
      state.compare.sort = { col: null, desc: false };
    }
    state.compare.code = code;
    state.compare.rows = [];
    state.compare.ts = 0;
    state.compare.loading = true;
    $('stkCompareBody').innerHTML = '';
    setEmpty('stkCompareEmpty', true, '加载中…');
    setWrapLoading('stkCompareWrap', true);

    var cached = readCompareCache(code);
    if (cached && !force && Date.now() - cached.ts <= BOARD_TTL) {
      state.compare.rows = cached.rows;
      state.compare.ts = cached.ts;
      state.compare.loading = false;
      setWrapLoading('stkCompareWrap', false);
      renderCompareRows();
      return;
    }

    try {
      var cons = await thsGet('/api/a-share-index/constituents/ths-stock-list',
        { thscode: code + '.TI' }, { timeout: 20000 });
      var members = (cons && cons.item ? cons.item : [])
        .filter(function (x) { return /^\d{6}$/.test(String(x.ticker || '')); })
        .map(function (x) { return { code: String(x.ticker), name: String(x.name || x.ticker) }; });
      if (!members.length) throw new Error('该板块没有成分股');
      if (token !== state.compare.token) return;

      var codes = members.map(function (m) { return m.code; });
      var quotes = {};
      try {
        quotes = await fetchTxQuotes(codes, {});
      } catch (e) {
        if (isAbort(e)) throw e;
      }
      var both = await Promise.all([fetchFinance(codes, {}), fetchDividends(codes, {})]);
      if (token !== state.compare.token) return;

      var rows = members.map(function (m) {
        var q = quotes[m.code] || {};
        var f = computeFinance(both[0][m.code], q, both[1][m.code]);
        return {
          code: m.code,
          name: m.name,
          price: q.price,
          chg: q.chg,
          float_cap: q.float_cap,
          roe: f.roe,
          net_margin: f.net_margin,
          asset_turnover: f.asset_turnover,
          equity_multiplier: f.equity_multiplier,
          ocf: f.ocf,
          liability: f.liability,
          debt_coverage: f.debt_coverage,
          dividend_yield: f.dividend_yield,
          pe: f.pe,
          pe_static: f.pe_static,
        };
      });
      rows.sort(function (a, b) {
        var va = isNum(a.chg) ? a.chg : -Infinity;
        var vb = isNum(b.chg) ? b.chg : -Infinity;
        return vb - va;
      });
      state.compare.rows = rows;
      state.compare.ts = Date.now();
      state.compare.loading = false;
      writeCompareCache(code, rows);
      setWrapLoading('stkCompareWrap', false);
      renderCompareRows();
    } catch (e) {
      if (token !== state.compare.token) return;
      handleApiError(e);
      state.compare.loading = false;
      setWrapLoading('stkCompareWrap', false);
      setEmpty('stkCompareEmpty', true, '加载失败，点板块 / 偏离中间的刷新按钮重试');
      toast(e.message, 'err');
    }
  }

  async function refreshSelectedStocks() {
    if (state.busy) {
      toast('计算中，请稍候');
      return;
    }
    if (!state.selected) {
      toast('请先选择一个板块');
      return;
    }
    var loading = state.tab === 'pool' ? state.pool.loading : state.compare.loading;
    if (loading) {
      toast('正在加载数据，请稍候');
      return;
    }
    if (!requireKey()) return;

    var btn = $('stkRefreshStocks');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-spinning');
    }
    var code = state.selected.code;
    var name = state.selected.name;
    try {
      if (!state.devs[code]) await ensureDev(code, name);
      if (state.tab === 'pool') await loadPoolStocks(code, name, true);
      else await loadCompare(code, name, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-spinning');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 标签 / 右侧面板                                                    */
  /* ------------------------------------------------------------------ */

  function loadRight(code, name) {
    if (state.tab === 'pool') {
      loadPoolStocks(code, name);
    } else {
      loadCompare(code, name);
    }
  }

  function switchTab(tab) {
    state.tab = tab;
    closePeriodMenus();
    $$('.stk-tab').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('stkPoolView').hidden = tab !== 'pool';
    $('stkBoardView').hidden = tab !== 'board';
    syncStockPeriodAvailability();

    if (!state.selected) return;
    if (tab === 'pool') {
      if (state.pool.code !== state.selected.code || state.pool.period !== state.stockPeriod ||
          (!state.pool.rows.length && !state.pool.loading)) {
        loadPoolStocks(state.selected.code, state.selected.name);
      }
    } else if (state.compare.code !== state.selected.code ||
               (!state.compare.rows.length && !state.compare.loading)) {
      loadCompare(state.selected.code, state.selected.name);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Key 设置                                                           */
  /* ------------------------------------------------------------------ */

  function renderApiBtn() {
    var btn = $('stkApiBtn');
    if (!btn) return;
    var show = !state.key || state.keyValid === false;
    btn.hidden = !show;
    btn.textContent = state.keyValid === false ? '重设 Key' : '设置 API';
    btn.title = state.keyValid === false ? 'Key 无效或没有权限，点击重设' : '设置同花顺 API Key';
  }

  async function checkKey(silent) {
    if (!state.key) {
      state.keyValid = null;
      renderApiBtn();
      return;
    }
    try {
      await testKeyValue(state.key);
      state.keyValid = true;
    } catch (e) {
      state.keyValid = false;
      if (!silent) throw e;
    }
    renderApiBtn();
  }

  function openKeyModal() {
    var modal = $('stkKeyModal');
    if (!modal) return;
    $('stkKeyInput').value = state.key;
    $('stkKeyInput').type = 'password';
    $('stkKeyToggle').textContent = '显示';
    $('stkKeyResult').textContent = '';
    $('stkKeyResult').className = 'stk-testresult';
    modal.hidden = false;
    setTimeout(function () { $('stkKeyInput').focus(); }, 30);
  }

  function closeKeyModal() {
    $('stkKeyModal').hidden = true;
  }

  async function testKeyFromModal() {
    var key = $('stkKeyInput').value.trim();
    var box = $('stkKeyResult');
    box.className = 'stk-testresult';
    if (!key) {
      box.className = 'stk-testresult is-err';
      box.textContent = '请先填写 API Key';
      return;
    }
    box.textContent = '正在测试…';
    $('stkKeyTest').disabled = true;
    try {
      await testKeyValue(key);
      box.className = 'stk-testresult is-ok';
      box.textContent = '✓ API Key 可用';
    } catch (e) {
      box.className = 'stk-testresult is-err';
      box.textContent = '✕ ' + e.message;
    } finally {
      $('stkKeyTest').disabled = false;
    }
  }

  function saveKeyFromModal() {
    var key = $('stkKeyInput').value.trim();
    if (key) writeLS(LS.key, key);
    else localStorage.removeItem(LS.key);
    state.key = key;
    state.keyValid = null;
    renderApiBtn();
    closeKeyModal();
    toast(key ? 'API Key 已保存' : '已清除 API Key');
    if (key) {
      checkKey(true);
      var cached = readLS(LS.catalog, null);
      if (!cached || !cached.ts || Date.now() - cached.ts > CATALOG_TTL) refreshCatalog().catch(function () {});
      if (state.selected) loadRight(state.selected.code, state.selected.name);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 偏好                                                               */
  /* ------------------------------------------------------------------ */

  function savePrefs() {
    writeLS(LS.prefs, {
      boardPeriod: state.boardPeriod,
      stockPeriod: state.stockPeriod,
    });
  }

  function loadPrefs() {
    var p = readLS(LS.prefs, null);
    if (!p) return;
    var bp = p.boardPeriod || p.period;
    if (PERIODS.indexOf(bp) >= 0) state.boardPeriod = bp;
    var sp = p.stockPeriod || p.speriod;
    if (PERIODS.indexOf(sp) >= 0) state.stockPeriod = sp;
  }

  function syncPeriodLabels() {
    $('stkBoardPeriodLabel').textContent = '板块 · ' + periodLabel(state.boardPeriod);
    $('stkStockPeriodLabel').textContent = '个股 · ' + periodLabel(state.stockPeriod);
    $$('#stkBoardPeriodMenu button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.value === state.boardPeriod);
    });
    $$('#stkStockPeriodMenu button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.value === state.stockPeriod);
    });
  }

  function setSideCollapsed(on, persist) {
    var side = document.querySelector('.stk-side');
    var layout = document.querySelector('.stk-layout');
    if (!side || !layout) return;
    if (on && state.busy) {
      toast('计算中，请先点计算按钮暂停再折叠');
      return;
    }
    state.sideCollapsed = !!on;
    side.classList.toggle('is-collapsed', !!on);
    layout.classList.toggle('is-side-collapsed', !!on);
    var collapse = $('stkSideCollapse');
    var expand = $('stkSideExpand');
    if (collapse) collapse.setAttribute('aria-expanded', on ? 'false' : 'true');
    if (expand) expand.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (persist) writeLS(LS.sideCollapsed, !!on);
    if (on) {
      closePeriodMenus();
      closeCompareMenu();
    }
  }

  function syncStockPeriodAvailability() {
    var btn = $('stkStockPeriodBtn');
    if (!btn) return;
    var off = state.tab === 'board';
    btn.disabled = off;
    btn.setAttribute('aria-disabled', off ? 'true' : 'false');
    btn.title = off
      ? '比价关系显示个股财务指标，使用不到个股周期'
      : '选择右侧个股的 K 线周期';
    if (off) {
      var menu = $('stkStockPeriodMenu');
      if (menu) menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function closePeriodMenus() {
    ['stkBoardPeriodMenu', 'stkStockPeriodMenu'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
    ['stkBoardPeriodBtn', 'stkStockPeriodBtn'].forEach(function (id) {
      var el = $(id);
      if (el) el.setAttribute('aria-expanded', 'false');
    });
  }

  /* ------------------------------------------------------------------ */
  /* 事件                                                               */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    $$('.stk-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        closeCompareMenu();
        switchTab(b.dataset.tab);
      });
    });

    $('stkSideCollapse').addEventListener('click', function () {
      setSideCollapsed(true, true);
    });
    $('stkSideExpand').addEventListener('click', function () {
      setSideCollapsed(false, true);
    });

    /* 周期下拉：板块 / 个股 各自三个周期 */
    $('stkBoardPeriodBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('stkBoardPeriodMenu');
      var open = menu.hidden;
      closePeriodMenus();
      menu.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('stkStockPeriodBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      if (this.disabled) return;
      var menu = $('stkStockPeriodMenu');
      var open = menu.hidden;
      closePeriodMenus();
      menu.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    $$('#stkBoardPeriodMenu button').forEach(function (b) {
      b.addEventListener('click', function () {
        closePeriodMenus();
        if (state.busy) {
          toast('计算中，请先点计算按钮暂停');
          return;
        }
        var next = b.dataset.value;
        if (state.boardPeriod === next) return;
        state.boardPeriod = next;
        syncPeriodLabels();
        savePrefs();
        loadDevs(next);
      });
    });
    $$('#stkStockPeriodMenu button').forEach(function (b) {
      b.addEventListener('click', function () {
        closePeriodMenus();
        if (state.busy) {
          toast('计算中，请先点计算按钮暂停');
          return;
        }
        var next = b.dataset.value;
        if (state.stockPeriod === next) return;
        state.stockPeriod = next;
        syncPeriodLabels();
        savePrefs();
        if (state.selected && state.tab === 'pool') {
          loadPoolStocks(state.selected.code, state.selected.name);
        }
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.stk-drop')) closePeriodMenus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closePeriodMenus();
        closeCompareMenu();
      }
    });

    /* 搜索框：直接可输入；只在检测到自动填充时清空，避免浏览器填用户名 */
    var filterInput = $('stkBoardFilter');
    function clearFilterIfUntyped() {
      if (state.userTyped) return;
      if (filterInput.value) {
        filterInput.value = '';
        state.filter = '';
        renderSide();
      }
    }
    function markUserTyping(e) {
      var it = (e && e.inputType) || '';
      if (it === 'insertText' || it === 'insertCompositionText' ||
          it === 'deleteContentBackward' || it === 'deleteContentForward') {
        state.userTyped = true;
      }
    }
    filterInput.addEventListener('beforeinput', markUserTyping);
    filterInput.addEventListener('focus', clearFilterIfUntyped);
    filterInput.addEventListener('keydown', function (e) {
      if ((e.key && e.key.length === 1) || e.key === 'Backspace' || e.key === 'Delete') {
        state.userTyped = true;
      }
    });
    filterInput.addEventListener('paste', function () { state.userTyped = true; });
    filterInput.addEventListener('compositionstart', function () { state.userTyped = true; });
    filterInput.addEventListener('blur', clearFilterIfUntyped);
    filterInput.addEventListener('input', function (e) {
      var it = e.inputType || '';
      var typing = it === 'insertText' || it === 'insertCompositionText' ||
        it === 'deleteContentBackward' || it === 'deleteContentForward';
      // 没有真实键盘/粘贴输入却出现了值，基本就是浏览器/密码管理器自动填的用户名
      if (!state.userTyped && !typing) {
        e.target.value = '';
        state.filter = '';
        renderSide();
        return;
      }
      if (typing) state.userTyped = true;
      state.filter = e.target.value;
      renderSide();
    });
    filterInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCalcClick();
      }
    });
    window.addEventListener('pageshow', clearFilterIfUntyped);
    window.addEventListener('focus', clearFilterIfUntyped);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') clearFilterIfUntyped();
    });
    setTimeout(clearFilterIfUntyped, 100);
    setTimeout(clearFilterIfUntyped, 500);
    setTimeout(clearFilterIfUntyped, 1500);
    $('stkCalcBoard').addEventListener('click', onCalcClick);
    $('stkRefreshStocks').addEventListener('click', refreshSelectedStocks);

    $('stkBoardBody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      selectBoard(tr.dataset.code, tr.dataset.name);
    });
    $$('#stkBoardWrap th.is-sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        var s = state.sort;
        if (s.col === key) s.desc = !s.desc;
        else { s.col = key; s.desc = key === 'dev'; }
        renderSide();
      });
    });

    $$('#stkStockWrap th.is-sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        var s = state.pool.sort || (state.pool.sort = { col: 'dev', desc: true });
        if (s.col === key) s.desc = !s.desc;
        else { s.col = key; s.desc = key !== 'code' && key !== 'name'; }
        renderPoolStocks();
      });
    });
    function bindStockRowEvents(tab, bodyId) {
      var body = $(bodyId);
      if (!body) return;
      body.addEventListener('click', function (e) {
        var tr = e.target.closest('tr');
        if (!tr) return;
        selectStockRow(tab, tr.dataset.code);
      });
      body.addEventListener('dblclick', function (e) {
        var tr = e.target.closest('tr');
        if (!tr) return;
        selectStockRow(tab, tr.dataset.code);
        openStockDetail(tr.dataset.code, tr.dataset.name, tab === 'pool');
      });
    }
    bindStockRowEvents('pool', 'stkStockBody');
    bindStockRowEvents('compare', 'stkCompareBody');

    $$('#stkCompareWrap th.is-sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.dataset.sort;
        var s = state.compare.sort || (state.compare.sort = { col: key, desc: true });
        if (s.col === key) s.desc = !s.desc;
        else { s.col = key; s.desc = key !== 'name' && key !== 'code'; }
        renderCompareRows();
      });
    });

    /* 比价个股：右键置顶 / 移到底部 */
    $('stkCompareBody').addEventListener('contextmenu', function (e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      e.preventDefault();
      selectStockRow('compare', tr.dataset.code);
      openCompareMenu(tr.dataset.code, e.clientX, e.clientY);
    });
    $('stkComparePin').addEventListener('click', function () {
      var code = state.ctxCode;
      closeCompareMenu();
      if (code) pinStock(code);
    });
    $('stkCompareUnpin').addEventListener('click', function () {
      var code = state.ctxCode;
      closeCompareMenu();
      if (code) unpinStock(code);
    });
    $('stkCompareBottom').addEventListener('click', function () {
      var code = state.ctxCode;
      closeCompareMenu();
      if (code) bottomStock(code);
    });
    $('stkCompareRestore').addEventListener('click', function () {
      var code = state.ctxCode;
      closeCompareMenu();
      if (code) restoreStock(code);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('#stkCompareMenu')) closeCompareMenu();
    });
    window.addEventListener('scroll', closeCompareMenu, true);
    window.addEventListener('resize', closeCompareMenu);

    /* 个股走势 / 5 年数据弹窗 */
    $('stkDetailClose').addEventListener('click', closeStockDetail);
    $('stkDetailModal').addEventListener('click', function (e) {
      if (e.target === $('stkDetailModal')) closeStockDetail();
    });
    $$('#stkDetailPeriods button').forEach(function (b) {
      b.addEventListener('click', function () { setDetailPeriod(b.dataset.period); });
    });
    $('stkDetailChart').addEventListener('mousemove', function (e) {
      var d = state.detail;
      var g = d.geom;
      if (!g) return;
      var rect = this.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var i = Math.floor((x - g.left) / g.barW);
      if (i < 0 || i >= g.view.length) {
        if (d.hover !== -1) { d.hover = -1; drawDetailChart(); }
        return;
      }
      if (d.hover !== i) { d.hover = i; drawDetailChart(); }
    });
    $('stkDetailChart').addEventListener('mouseleave', function () {
      if (state.detail.hover !== -1) {
        state.detail.hover = -1;
        drawDetailChart();
      }
    });
    window.addEventListener('resize', function () {
      if (!$('stkDetailModal').hidden) drawDetailChart();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('stkDetailModal').hidden) closeStockDetail();
    });

    $('stkApiBtn').addEventListener('click', openKeyModal);
    $('stkKeyClose').addEventListener('click', closeKeyModal);
    $('stkKeyModal').addEventListener('click', function (e) {
      if (e.target === $('stkKeyModal')) closeKeyModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeKeyModal();
    });
    $('stkKeyTest').addEventListener('click', testKeyFromModal);
    $('stkKeySave').addEventListener('click', saveKeyFromModal);
    $('stkKeyClear').addEventListener('click', function () {
      $('stkKeyInput').value = '';
      localStorage.removeItem(LS.key);
      state.key = '';
      state.keyValid = null;
      renderApiBtn();
      $('stkKeyResult').textContent = '已清除';
      $('stkKeyResult').className = 'stk-testresult';
    });
    $('stkKeyToggle').addEventListener('click', function () {
      var input = $('stkKeyInput');
      var hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      $('stkKeyToggle').textContent = hidden ? '隐藏' : '显示';
    });
  }

  /* ------------------------------------------------------------------ */
  /* 初始化                                                             */
  /* ------------------------------------------------------------------ */

  async function init() {
    try {
      state.key = String(readLS(LS.key, '') || '').trim();
    } catch (e) {
      state.key = '';
    }
    loadPrefs();
    loadPinned();
    state.sideCollapsed = !!readLS(LS.sideCollapsed, false);
    syncPeriodLabels();
    syncStockPeriodAvailability();
    if (window.__stkFilterTyped) state.userTyped = true;
    bindEvents();
    setSideCollapsed(state.sideCollapsed, false);
    renderApiBtn();

    await loadCatalog();
    loadDevs(state.boardPeriod);
    renderSide();
    renderPoolStocks();
    renderCompareRows();

    if (state.key) checkKey(true);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

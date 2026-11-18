/* 缠论读书会 · 跨用户正文注释
   1. 在正文里选中文字 → 浮出「注释」小按钮 → 写注释（不需要登录）；
   2. 注释按课存放，同一课所有用户的注释共用一份，课与课互不混淆；
   3. 注释按「段落」聚合：某一段里有注释，这一段末尾就浮出一个小按钮「注 N」，
      点它在右侧展开这一段所有读者的注释，再点一次（或点别处 / Esc）收起；
      一个段落只有一个入口，段内所有注释都在这一个浮层里；
   4. 正文画线只画「自己写的」注释，别人的注释不画线；段落入口的计数和浮层
      始终是全量（所有人），点浮层里的「定位」会滚到那一段；
   5. 每课注释在本地缓存 5 分钟，同一课短时间内不重复请求云端，
      浮层右上角「↻」可强制刷新。

   数据走云函数（cloudfunctions/api/index.js）：
     getChanAnnotations / createChanAnnotation / deleteChanAnnotation
   身份用浏览器本地生成的 clientId + secret，清缓存会变成新身份（旧注释仍可读）。 */
(function () {
  "use strict";

  var reader = document.getElementById("chanReader");
  var scrollBox = document.getElementById("chanScroll");
  var cfg = window.CHAN_CFG || {};

  var pop = document.getElementById("chanAnnoPop");
  var popTitle = document.getElementById("chanAnnoTitle");
  var popCount = document.getElementById("chanAnnoCount");
  var popList = document.getElementById("chanAnnoList");
  var popRefresh = document.getElementById("chanAnnoRefresh");
  var popClose = document.getElementById("chanAnnoClose");

  var tip = document.getElementById("chanAnnoTip");
  var tipBtn = document.getElementById("chanAnnoAdd");

  var dialog = document.getElementById("chanAnnoDialog");
  var dialogBox = document.querySelector(".chan-anno-dialog__box");
  var dialogBar = document.getElementById("chanAnnoDialogBar");
  var dlgTitle = document.getElementById("chanAnnoDialogTitle");
  var dlgTip = document.getElementById("chanAnnoDialogTip");
  var dlgQuote = document.getElementById("chanAnnoDialogQuote");
  var dlgNote = document.getElementById("chanAnnoNote");
  var dlgNoteCount = document.getElementById("chanAnnoNoteCount");
  var dlgName = document.getElementById("chanAnnoName");
  var dlgError = document.getElementById("chanAnnoError");
  var dlgSubmit = document.getElementById("chanAnnoSubmit");
  var dlgCancel = document.getElementById("chanAnnoCancel");
  var dlgClose = document.getElementById("chanAnnoDialogClose");

  if (!reader || !scrollBox) return;
  if (!pop || !popList) return;
  if (!dialog || !dlgNote || !dlgSubmit) return;
  if (!cfg.api || !cfg.key) return;

  /* ------------------------------------------------------------ 本地身份 */

  var LS_ID = "chan:anno:id";
  var LS_SECRET = "chan:anno:secret";
  var LS_NAME = "chan:anno:name";
  var TRADE_USER_KEY = "huideng.trade.user";

  // 每课注释的本地缓存：5 分钟内不重复请求云端；key 带 lessonNo，
  // 所以缓存天然按课隔离，绝不会把别的课注释显示到这一课。
  var CACHE_PREFIX = "chan:anno:cache:";
  var CACHE_TTL = 5 * 60 * 1000;
  var CACHE_MAX = 20;

  function load(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function store(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式下存不了，忽略：本次仍然可用，刷新后换新身份 */
    }
  }

  function randomHex(bytes) {
    var out = "";
    var i;
    try {
      var buf = new Uint8Array(bytes);
      window.crypto.getRandomValues(buf);
      for (i = 0; i < buf.length; i += 1) {
        out += (buf[i] + 0x100).toString(16).slice(1);
      }
    } catch (e) {
      out = "";
      for (i = 0; i < bytes * 2; i += 1) {
        out += Math.floor(Math.random() * 16).toString(16);
      }
    }
    return out;
  }

  var clientId = load(LS_ID);
  if (!clientId) {
    clientId = randomHex(12);
    store(LS_ID, clientId);
  }
  var secret = load(LS_SECRET);
  if (!secret) {
    secret = randomHex(24);
    store(LS_SECRET, secret);
  }

  function savedName() {
    return load(LS_NAME) || load(TRADE_USER_KEY) || "";
  }

  // 注释署名：自动取「我的名字」（头像菜单里设置），没设置就退回账户名 / 匿名
  function displayName() {
    var n = String(savedName() || "")
      .replace(/^@+/, "")
      .trim()
      .slice(0, 20);
    return n || "匿名读者";
  }

  /* -------------------------------------------------------------- 状态 */

  var cache = {}; // lessonNo -> { list: [], at: ts }
  var loading = {}; // lessonNo -> true
  var lessonNo = 0;
  var lessonTitle = "";

  // 段落分组：groups[段落序号] = { el, list, orphan }；
  // annoHost[注释 id] = 段落序号（点正文标记时用来展开对应段落）。
  var groups = [];
  var annoHost = {};
  var activeHost = -1;
  var popOpen = false;

  var pending = null; // 选中待写：{ anchor: {s,e}, quote }
  var editing = null; // 正在写：{ anchor, quote }
  var submitting = false;
  var toastEl = null;
  var toastTimer = 0;

  /* -------------------------------------------------------------- 工具 */

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function normSpace(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactText(s) {
    return String(s || "").replace(/\s+/g, "");
  }

  function formatTime(ts) {
    var n = Number(ts) || 0;
    if (!n) return "";
    var d = new Date(n);
    return (
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes())
    );
  }

  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "chan-anno-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.hidden = true;
      toastTimer = 0;
    }, 2800);
  }

  function activeSection() {
    return reader.querySelector(".chan-lesson.is-on");
  }

  /* -------------------------------------------------------------- 接口 */

  function mkErr(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  function api(action, params, timeout) {
    var body = { action: action };
    if (params) {
      Object.keys(params).forEach(function (k) {
        body[k] = params[k];
      });
    }
    var ctl = null;
    var timer = 0;
    if (window.AbortController) {
      ctl = new AbortController();
      timer = window.setTimeout(function () {
        try {
          ctl.abort();
        } catch (e) {}
      }, timeout || 25000);
    }
    var opts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.key,
        "x-device-id": "web-chan",
      },
      body: JSON.stringify(body),
    };
    if (ctl) opts.signal = ctl.signal;

    return fetch(cfg.api, opts)
      .then(function (res) {
        if (timer) {
          window.clearTimeout(timer);
          timer = 0;
        }
        if (!res.ok) throw mkErr("http_" + res.status);
        return res.json();
      })
      .then(function (j) {
        if (!j || !j.ok) throw mkErr((j && j.error) || "error");
        return j;
      })
      .catch(function (e) {
        if (timer) window.clearTimeout(timer);
        if (e && e.code) throw e;
        throw mkErr("network");
      });
  }

  function errorText(e) {
    var code = e && e.code ? e.code : "";
    if (code === "rate_limited") return "发布太频繁了，歇一会儿再试";
    if (code === "empty_note") return "注释不能为空";
    if (code === "empty_quote") return "请先选中正文里的文字";
    if (code === "bad_request") return "内容有点问题，请检查后再试";
    if (code === "not_found") return "这条注释已经不在了";
    if (code === "forbidden") return "只能编辑或删除自己写的注释";
    return "网络不给力，请稍后重试";
  }

  /* ---------------------------------------------------- 课内文本与锚点 */

  var BLOCK_SELECTOR = "p, h2, h3, td, th, li, figcaption, blockquote";

  // 把一课里的文本块按文档顺序拼成一条「文本流」，块之间用 \n 隔开。
  // 注释存的就是这条流上的 [s, e)，换设备、换字号都不影响定位。
  function blockLayout(sec) {
    var found = sec.querySelectorAll(BLOCK_SELECTOR);
    var blocks = [];
    var i;
    for (i = 0; i < found.length; i += 1) {
      var el = found[i];
      // 评论区不是正文，不能参与注释锚点/高亮
      if (el.closest && el.closest(".chan-comments")) continue;
      var t = el.textContent;
      if (!t || !t.trim()) continue;
      blocks.push(el);
    }
    var starts = [];
    var texts = [];
    var text = "";
    for (i = 0; i < blocks.length; i += 1) {
      var bt = blocks[i].textContent;
      starts.push(text.length);
      texts.push(bt);
      text += bt + "\n";
    }
    return { blocks: blocks, starts: starts, texts: texts, text: text };
  }

  function offsetInBlock(block, container, offset) {
    try {
      var r = document.createRange();
      r.selectNodeContents(block);
      r.setEnd(container, offset);
      return r.toString().length;
    } catch (e) {
      return -1;
    }
  }

  function rangeHits(sec, range) {
    if (range.intersectsNode) {
      try {
        return range.intersectsNode(sec);
      } catch (e) {
        /* 落到下面的 contains 判断 */
      }
    }
    return sec.contains(range.commonAncestorContainer);
  }

  function anchorFromRange(sec, range) {
    var layout = blockLayout(sec);
    var first = -1;
    var last = -1;
    var i;
    for (i = 0; i < layout.blocks.length; i += 1) {
      var b = layout.blocks[i];
      var hit;
      if (range.intersectsNode) {
        try {
          hit = range.intersectsNode(b);
        } catch (e) {
          hit = false;
        }
      } else {
        hit = b.contains(range.commonAncestorContainer);
      }
      if (!hit) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) return null;

    var sOff = 0;
    var eOff = layout.texts[last].length;
    if (layout.blocks[first].contains(range.startContainer)) {
      var so = offsetInBlock(layout.blocks[first], range.startContainer, range.startOffset);
      if (so >= 0) sOff = so;
    }
    if (layout.blocks[last].contains(range.endContainer)) {
      var eo = offsetInBlock(layout.blocks[last], range.endContainer, range.endOffset);
      if (eo >= 0) eOff = eo;
    }
    var s = layout.starts[first] + sOff;
    var e = layout.starts[last] + eOff;
    if (e <= s) return null;
    return { s: s, e: e };
  }

  // 去空白后在文本流里找 quote，返回原文偏移；用于锚点失效时兜底。
  function findQuote(layout, quote) {
    var needle = compactText(quote);
    if (!needle) return null;
    var text = layout.text;
    var map = [];
    var hay = "";
    var i;
    for (i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (/\s/.test(ch)) continue;
      hay += ch;
      map.push(i);
    }
    var idx = hay.indexOf(needle);
    if (idx < 0) return null;
    return { s: map[idx], e: map[idx + needle.length - 1] + 1 };
  }

  function resolveRange(layout, a) {
    var s = a.anchor ? Number(a.anchor.s) : NaN;
    var e = a.anchor ? Number(a.anchor.e) : NaN;
    var quote = normSpace(a.quote);
    if (
      isFinite(s) &&
      isFinite(e) &&
      s >= 0 &&
      e > s &&
      e <= layout.text.length &&
      (!quote || normSpace(layout.text.slice(s, e)) === quote)
    ) {
      return { s: s, e: e };
    }
    if (!quote) return null;
    return findQuote(layout, quote);
  }

  /* ------------------------------------------------------------ 正文标记 */

  function clearHighlights(sec) {
    var marks = sec.querySelectorAll("mark.chan-anno-hl");
    var i;
    for (i = 0; i < marks.length; i += 1) {
      var m = marks[i];
      var parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(m.textContent || ""), m);
    }
    if (sec.normalize) sec.normalize();
  }

  function wrapNode(node, id) {
    var parent = node.parentNode;
    if (!parent) return;
    var mark = document.createElement("mark");
    mark.className = "chan-anno-hl";
    mark.setAttribute("data-anno", id);
    parent.replaceChild(mark, node);
    mark.appendChild(node);
  }

  function wrapRange(block, start, end, id) {
    if (end <= start) return;
    var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);

    var pos = 0;
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var len = node.nodeValue.length;
      var nodeStart = pos;
      pos += len;
      if (pos <= start || nodeStart >= end) continue;

      var localStart = Math.max(0, start - nodeStart);
      var localEnd = Math.min(len, end - nodeStart);
      var target = node;
      if (localStart > 0 || localEnd < len) {
        if (localStart > 0) target = target.splitText(localStart);
        if (localEnd - localStart < target.nodeValue.length) {
          target.splitText(localEnd - localStart);
        }
      }
      wrapNode(target, id);
    }
  }

  function applyHighlights(sec, list) {
    clearHighlights(sec);
    if (!list || !list.length) return;
    var layout = blockLayout(sec);
    var i;
    var j;
    for (i = 0; i < list.length; i += 1) {
      var range = resolveRange(layout, list[i]);
      if (!range) continue;
      for (j = 0; j < layout.blocks.length; j += 1) {
        var bStart = layout.starts[j];
        var bEnd = bStart + layout.texts[j].length;
        var s = Math.max(range.s, bStart);
        var e = Math.min(range.e, bEnd);
        if (s < e) wrapRange(layout.blocks[j], s - bStart, e - bStart, list[i].id);
      }
    }
  }

  /* -------------------------------------------------------- 段落分组与入口 */

  // 注释入口可以挂在标题和正文段落上：标题上的注释就显示在标题处
  function entryHosts(sec) {
    var found = sec.querySelectorAll(
      ".chan-lesson__title, .chan-prose p, .chan-prose h2, .chan-prose h3," +
        " .chan-prose blockquote, .chan-prose li, .chan-prose figcaption"
    );
    var hosts = [];
    var i;
    for (i = 0; i < found.length; i += 1) {
      var el = found[i];
      if (el.classList.contains("chan-stamp")) continue;
      if (el.classList.contains("chan-orphan")) continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      hosts.push(el);
    }
    return hosts;
  }

  function blockIndexAt(layout, pos) {
    var i;
    for (i = 0; i < layout.blocks.length; i += 1) {
      var s = layout.starts[i];
      // +1 是块之间那个换行分隔符
      if (pos >= s && pos < s + layout.texts[i].length + 1) return i;
    }
    return -1;
  }

  // 注释落在哪个段落：表格 / 小标题这类块挂到最近的上一段，没有就挂下一段
  function hostIndexFor(hosts, layout, blockIndex) {
    var i;
    var idx;
    for (i = blockIndex; i >= 0; i -= 1) {
      idx = hosts.indexOf(layout.blocks[i]);
      if (idx >= 0) return idx;
    }
    for (i = blockIndex + 1; i < layout.blocks.length; i += 1) {
      idx = hosts.indexOf(layout.blocks[i]);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  // 把一课注释按段落聚合；原文改动后定位不到的旧注释单独归一组
  function buildGroups(sec, list) {
    var layout = blockLayout(sec);
    var hosts = entryHosts(sec);
    var grouped = hosts.map(function (el) {
      return { el: el, list: [] };
    });
    var map = {};
    var orphans = [];
    var i;
    for (i = 0; i < (list ? list.length : 0); i += 1) {
      var a = list[i];
      var range = resolveRange(layout, a);
      var hi = -1;
      if (range) {
        var bi = blockIndexAt(layout, range.s);
        if (bi >= 0) hi = hostIndexFor(hosts, layout, bi);
      }
      if (hi < 0) {
        orphans.push(a);
        continue;
      }
      grouped[hi].list.push(a);
      if (a.id) map[a.id] = hi;
    }
    if (orphans.length) {
      grouped.push({ el: null, orphan: true, list: orphans });
    }
    return { groups: grouped, annoHost: map };
  }

  function clearChips(sec) {
    var chips = sec.querySelectorAll("button.chan-para-anno");
    var i;
    for (i = 0; i < chips.length; i += 1) {
      if (chips[i].parentNode) chips[i].parentNode.removeChild(chips[i]);
    }
    var orphans = sec.querySelectorAll(".chan-prose .chan-orphan");
    for (i = 0; i < orphans.length; i += 1) {
      if (orphans[i].parentNode) orphans[i].parentNode.removeChild(orphans[i]);
    }
  }

  // 按钮里不放文本节点：计数走 ::after，正文的文本流偏移才不会被按钮撑乱。
  function makeChip(pi, count) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chan-para-anno";
    chip.setAttribute("data-pi", String(pi));
    chip.setAttribute("data-count", String(count));
    chip.setAttribute("aria-controls", "chanAnnoPop");
    chip.setAttribute("aria-expanded", "false");
    chip.setAttribute("aria-label", "本段 " + count + " 条注释，展开");
    chip.title = "本段 " + count + " 条注释";
    return chip;
  }

  function renderChips(sec) {
    var i;
    for (i = 0; i < groups.length; i += 1) {
      var g = groups[i];
      if (!g.list.length) continue;
      var chip = makeChip(i, g.list.length);
      if (g.orphan) {
        var prose = sec.querySelector(".chan-prose");
        if (!prose) continue;
        var p = document.createElement("p");
        p.className = "chan-orphan";
        var label = document.createElement("span");
        label.className = "chan-orphan__label";
        label.textContent = "更早的注释";
        p.appendChild(label);
        p.appendChild(chip);
        prose.appendChild(p);
      } else {
        g.el.appendChild(chip);
      }
    }
    syncChips(sec);
  }

  function syncChips(sec) {
    sec = sec || activeSection();
    if (!sec) return;
    var chips = sec.querySelectorAll("button.chan-para-anno");
    var i;
    for (i = 0; i < chips.length; i += 1) {
      var chip = chips[i];
      var on = popOpen && Number(chip.getAttribute("data-pi")) === activeHost;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-expanded", on ? "true" : "false");
      var count = Number(chip.getAttribute("data-count")) || 0;
      chip.setAttribute("aria-label", "本段 " + count + " 条注释，" + (on ? "收起" : "展开"));
    }
  }

  function renderLesson(sec, list) {
    clearHighlights(sec);
    clearChips(sec);
    // 正文画线只画自己的：别人的注释点开段落入口就能看到，不铺满正文
    var own = (list || []).filter(function (a) {
      return a.mine;
    });
    applyHighlights(sec, own);
    var built = buildGroups(sec, list);
    groups = built.groups;
    annoHost = built.annoHost;
    renderChips(sec);
  }

  /* ------------------------------------------------------------ 数据加载 */

  function renderAnnotations(no) {
    if (no !== lessonNo) return;
    var sec = activeSection();
    if (sec) renderLesson(sec, cache[no] ? cache[no].list : []);
    if (popOpen) {
      if (!groups[activeHost]) closePop();
      else renderPop();
    }
  }

  function cacheKey(no) {
    return CACHE_PREFIX + no;
  }

  // 本地缓存只在 TTL 内有效；过期或损坏就当没有，下次照常请求云端。
  function readStoredCache(no) {
    try {
      var raw = window.localStorage.getItem(cacheKey(no));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.at || !Array.isArray(obj.list)) return null;
      if (Date.now() - obj.at > CACHE_TTL) {
        window.localStorage.removeItem(cacheKey(no));
        return null;
      }
      return { list: obj.list, at: obj.at };
    } catch (e) {
      return null;
    }
  }

  // 只保留最近 CACHE_MAX 课，避免 localStorage 越攒越多。
  function pruneStoredCaches(keepNo) {
    try {
      var keys = [];
      var i;
      for (i = 0; i < window.localStorage.length; i += 1) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      var live = [];
      for (i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        var at = 0;
        try {
          var obj = JSON.parse(window.localStorage.getItem(key) || "null");
          at = (obj && obj.at) || 0;
        } catch (e) {}
        if (!at || Date.now() - at > CACHE_TTL) {
          window.localStorage.removeItem(key);
          continue;
        }
        var no = Number(key.slice(CACHE_PREFIX.length));
        if (no === keepNo) continue;
        live.push({ key: key, at: at });
      }
      live.sort(function (a, b) {
        return b.at - a.at;
      });
      for (i = CACHE_MAX - 1; i < live.length; i += 1) {
        window.localStorage.removeItem(live[i].key);
      }
    } catch (e) {}
  }

  function writeStoredCache(no, rec) {
    try {
      var payload = JSON.stringify({ at: rec.at, list: rec.list });
      // 单课数据过大就不占本地空间，下次照常联网取。
      if (payload.length > 400 * 1024) return;
      window.localStorage.setItem(cacheKey(no), payload);
      pruneStoredCaches(no);
    } catch (e) {
      // 空间不足：清掉注释缓存，不影响页面其它功能。
      try {
        var keys = [];
        var i;
        for (i = 0; i < window.localStorage.length; i += 1) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
        }
        for (i = 0; i < keys.length; i += 1) window.localStorage.removeItem(keys[i]);
      } catch (e2) {}
    }
  }

  function loadAnnotations(no, force) {
    if (!no || loading[no]) return;
    var cached = cache[no] || readStoredCache(no);
    if (cached) cache[no] = cached;
    if (!force && cached && Date.now() - cached.at < CACHE_TTL) {
      renderAnnotations(no);
      return;
    }
    // 过期缓存先显示，后台再更新，避免段落入口空白闪一下。
    if (cached) renderAnnotations(no);
    loading[no] = true;
    if (popOpen && no === lessonNo) renderPop();
    api("getChanAnnotations", { lessonNo: no, clientId: clientId })
      .then(function (j) {
        loading[no] = false;
        var rec = { list: (j && j.annotations) || [], at: Date.now() };
        cache[no] = rec;
        writeStoredCache(no, rec);
        if (no === lessonNo) renderAnnotations(no);
      })
      .catch(function () {
        loading[no] = false;
        if (no === lessonNo && popOpen) {
          // 有缓存就继续显示旧注释，别把用户正在看的内容清空
          renderPop(!cache[no]);
          toast("注释加载失败，点右上角 ↻ 重试");
        }
      });
  }

  /* -------------------------------------------------------------- 浮层 */

  function emptyLine(text) {
    var p = document.createElement("p");
    p.className = "chan-anno-empty";
    p.textContent = text;
    return p;
  }

  function itemEl(a) {
    var box = document.createElement("article");
    box.className = "chan-anno-item";
    box.setAttribute("data-id", a.id || "");

    var quote = document.createElement("blockquote");
    quote.className = "chan-anno-item__quote";
    quote.setAttribute("data-act", "locate");
    quote.title = "点击定位到原文";
    quote.textContent = a.quote || "";
    box.appendChild(quote);

    var note = document.createElement("p");
    note.className = "chan-anno-item__note";
    note.textContent = a.note || "";
    box.appendChild(note);

    var meta = document.createElement("div");
    meta.className = "chan-anno-item__meta";

    var who = document.createElement("span");
    who.className = "chan-anno-item__who";
    var whoName = a.mine ? displayName() : a.name || "匿名读者";
    who.textContent = String(whoName).replace(/^@+/, "");
    meta.appendChild(who);

    var time = document.createElement("time");
    var ts = Number(a.createdAt) || 0;
    if (ts) {
      var iso = new Date(ts).toISOString();
      time.setAttribute("datetime", iso);
    }
    time.textContent = formatTime(ts);
    meta.appendChild(time);

    if (Number(a.updatedAt)) {
      var edited = document.createElement("span");
      edited.className = "chan-anno-item__edited";
      edited.textContent = "已编辑";
      meta.appendChild(edited);
    }

    var acts = document.createElement("span");
    acts.className = "chan-anno-item__acts";

    var locateBtn = document.createElement("button");
    locateBtn.type = "button";
    locateBtn.setAttribute("data-act", "locate");
    locateBtn.textContent = "定位";
    acts.appendChild(locateBtn);

    if (a.mine) {
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.setAttribute("data-act", "edit");
      editBtn.textContent = "编辑";
      acts.appendChild(editBtn);

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.setAttribute("data-act", "del");
      delBtn.textContent = "删除";
      acts.appendChild(delBtn);
    }

    meta.appendChild(acts);
    box.appendChild(meta);
    return box;
  }

  function renderPop(failed) {
    if (!popList) return;
    popList.innerHTML = "";
    var g = groups[activeHost];
    if (!g) return;
    if (popTitle) popTitle.textContent = g.orphan ? "更早的注释" : "注释";
    if (popCount) popCount.textContent = String(g.list.length);
    if (failed) {
      popList.appendChild(emptyLine("注释加载失败，点右上角 ↻ 再试一次。"));
      return;
    }
    if (!g.list.length) {
      popList.appendChild(emptyLine("这里还没有注释。选中正文文字即可添加。"));
      return;
    }
    for (var i = 0; i < g.list.length; i += 1) {
      popList.appendChild(itemEl(g.list[i]));
    }
  }

  // 顶部菜单（站内顶栏）下沿：iframe 内嵌时顶栏是 display:none，返回 0
  function navOffset() {
    var nav = document.querySelector(".topnav");
    if (!nav) return 0;
    var r = nav.getBoundingClientRect();
    return r.height > 0 ? Math.max(0, Math.round(r.bottom)) : 0;
  }

  function placePop() {
    if (!pop) return;
    pop.style.top = navOffset() + "px";
  }

  // 展开某一段：pi 是段落序号，focusId 用于点正文标记时把对应那条滚进视野
  function openPop(pi, focusId) {
    if (!pop || !groups[pi]) return;
    activeHost = pi;
    popOpen = true;
    placePop();
    pop.hidden = false;
    renderPop();
    syncChips();
    // 打开时缓存过期就让它在后台刷一次，看到的仍是最新注释
    var d = cache[lessonNo] || readStoredCache(lessonNo);
    if (d) cache[lessonNo] = d;
    if (!d) loadAnnotations(lessonNo, true);
    else if (Date.now() - d.at >= CACHE_TTL) loadAnnotations(lessonNo);
    if (focusId) focusItem(focusId);
  }

  function closePop() {
    popOpen = false;
    activeHost = -1;
    if (pop) pop.hidden = true;
    syncChips();
  }

  function togglePop(pi) {
    if (popOpen && activeHost === pi) closePop();
    else openPop(pi);
  }

  function focusItem(id) {
    if (!popList || !id) return;
    var items = popList.querySelectorAll(".chan-anno-item");
    var i;
    for (i = 0; i < items.length; i += 1) {
      if (items[i].getAttribute("data-id") === id) {
        try {
          items[i].scrollIntoView({ block: "nearest" });
        } catch (e) {}
        return;
      }
    }
  }

  function findMark(sec, id) {
    var marks = sec.querySelectorAll("mark.chan-anno-hl");
    var i;
    for (i = 0; i < marks.length; i += 1) {
      if (marks[i].getAttribute("data-anno") === id) return marks[i];
    }
    return null;
  }

  function flashMark(mark) {
    if (!mark) return;
    mark.classList.add("is-flash");
    window.setTimeout(function () {
      mark.classList.remove("is-flash");
    }, 1400);
  }

  // 别人的注释没有画线，定位时让段落入口闪一下，告诉用户是哪一段
  function flashChip(pi) {
    var sec = activeSection();
    if (!sec) return;
    var chip = sec.querySelector('button.chan-para-anno[data-pi="' + pi + '"]');
    if (!chip) return;
    chip.classList.add("is-flash");
    window.setTimeout(function () {
      chip.classList.remove("is-flash");
    }, 1400);
  }

  function locate(id) {
    var sec = activeSection();
    if (!sec) return;
    var mark = findMark(sec, id);
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      flashMark(mark);
      return;
    }
    // 别人的注释没有正文画线：滚到它所在的那一段
    var pi = annoHost[id];
    var g = pi === undefined ? null : groups[pi];
    if (g && g.el) {
      g.el.scrollIntoView({ block: "center", behavior: "smooth" });
      flashChip(pi);
      return;
    }
    toast("原文位置有变化，这条暂时定位不到");
  }

  function removeAnnotation(id) {
    if (!window.confirm("删除这条注释？")) return;
    api("deleteChanAnnotation", {
      id: id,
      clientId: clientId,
      clientSecret: secret,
    })
      .then(function () {
        var d = cache[lessonNo];
        if (d) {
          d.list = d.list.filter(function (x) {
            return x.id !== id;
          });
          d.at = Date.now();
          writeStoredCache(lessonNo, d);
        }
        renderAnnotations(lessonNo);
        // 这一段删空后入口也不见了，浮层跟着收起
        if (!groups[activeHost] || !groups[activeHost].list.length) closePop();
        toast("已删除");
      })
      .catch(function (e) {
        toast(errorText(e));
      });
  }

  /* ------------------------------------------------------------ 选中文字 */

  function hideTip() {
    if (!tip) return;
    tip.hidden = true;
    pending = null;
  }

  function showTip(range) {
    if (!tip) return;
    var rects = range.getClientRects();
    var rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;

    tip.hidden = false;
    var coarse =
      window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    var tipW = tip.offsetWidth;
    var tipH = tip.offsetHeight;
    var x = rect.left + rect.width / 2;
    var y = coarse ? rect.top - tipH - 10 : rect.bottom + 10;
    if (y < 8) y = rect.bottom + 10;
    if (y + tipH > window.innerHeight - 8) y = Math.max(8, rect.top - tipH - 10);
    // 选区在视口外时也别把按钮画到屏幕外面去
    y = Math.min(Math.max(y, 8), window.innerHeight - tipH - 8);
    var left = Math.min(Math.max(x - tipW / 2, 8), window.innerWidth - tipW - 8);
    tip.style.left = left + "px";
    tip.style.top = y + "px";
  }

  function checkSelection() {
    if (!dialog.hidden) return;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hideTip();
      return;
    }
    var range = sel.getRangeAt(0);
    var sec = activeSection();
    if (!sec || !rangeHits(sec, range)) {
      hideTip();
      return;
    }
    // 选中评论/回复文字时不弹注释按钮
    var commentsBox = sec.querySelector(".chan-comments");
    if (commentsBox && commentsBox.contains(range.commonAncestorContainer)) {
      hideTip();
      return;
    }
    var anchor = anchorFromRange(sec, range);
    var quote = normSpace(sel.toString());
    if (!anchor || !quote) {
      hideTip();
      return;
    }
    pending = { anchor: anchor, quote: quote.slice(0, 400) };
    showTip(range);
  }

  var selTimer = 0;
  function scheduleCheck(delay) {
    if (selTimer) window.clearTimeout(selTimer);
    selTimer = window.setTimeout(function () {
      selTimer = 0;
      checkSelection();
    }, delay);
  }

  /* ---------------------------------------------------------- 写注释弹层 */

  function clearSelection() {
    try {
      var sel = window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) {}
  }

  function showError(text) {
    if (!dlgError) return;
    dlgError.textContent = text;
    dlgError.hidden = false;
  }

  /* 注释弹层可以按住标题栏拖动，但不会跑出屏幕 */
  function setupDialogDrag() {
    if (!dialogBox || !dialogBar) return;
    var startX = 0;
    var startY = 0;
    var baseX = 0;
    var baseY = 0;
    var dragging = false;

    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (dialog.hidden) return;
      var rect = dialogBox.getBoundingClientRect();
      baseX = rect.left;
      baseY = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      try {
        dialogBar.setPointerCapture(e.pointerId);
      } catch (err) {}
      if (e.cancelable) e.preventDefault();
    }

    function onMove(e) {
      if (!dragging) return;
      var w = dialogBox.offsetWidth;
      var h = dialogBox.offsetHeight;
      var left = baseX + e.clientX - startX;
      var top = baseY + e.clientY - startY;
      left = Math.min(Math.max(left, 8), Math.max(8, window.innerWidth - w - 8));
      top = Math.min(Math.max(top, 8), Math.max(8, window.innerHeight - h - 8));
      dialogBox.style.transform =
        "translate(" + (left - baseX) + "px," + (top - baseY) + "px)";
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      try {
        dialogBar.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    dialogBar.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", function () {
      if (dialogBox && !dialog.hidden) dialogBox.style.transform = "";
    });
  }

  setupDialogDrag();

  // 弹层既能新建也能编辑：editing.id 有值就是编辑自己已有的那条
  function openCompose() {
    if (!pending) return;
    var p = pending;
    pending = null;
    hideTip();
    showCompose({
      id: "",
      quote: p.quote,
      anchor: p.anchor,
      note: "",
      name: savedName(),
    });
  }

  function openEdit(id) {
    var d = cache[lessonNo];
    var item = null;
    var i;
    if (d) {
      for (i = 0; i < d.list.length; i += 1) {
        if (d.list[i].id === id) {
          item = d.list[i];
          break;
        }
      }
    }
    if (!item || !item.mine) {
      toast("只能编辑自己写的注释");
      return;
    }
    showCompose({
      id: item.id,
      quote: item.quote || "",
      anchor: item.anchor || null,
      note: item.note || "",
      name: item.name || "",
    });
  }

  function showCompose(data) {
    var isEdit = !!data.id;
    if (dialogBox) dialogBox.style.transform = "";
    editing = { id: data.id, quote: data.quote, anchor: data.anchor };
    dlgQuote.textContent = editing.quote || "";
    dlgNote.value = data.note || "";
    if (dlgNoteCount) dlgNoteCount.textContent = String(dlgNote.value.length);
    dlgName.value = displayName();
    if (dlgTitle) dlgTitle.textContent = isEdit ? "编辑注释" : "添加注释";
    if (dlgTip) {
      dlgTip.textContent = isEdit
        ? "保存后，本课所有读者都会看到更新后的内容。"
        : "发布后，本课所有读者都能看到这条注释。";
    }
    if (dlgError) dlgError.hidden = true;
    dlgSubmit.disabled = false;
    dlgSubmit.textContent = isEdit ? "保存" : "发布";
    submitting = false;
    dialog.hidden = false;
    window.setTimeout(function () {
      try {
        dlgNote.focus();
      } catch (e) {}
    }, 40);
  }

  function submitLabel() {
    return editing && editing.id ? "保存" : "发布";
  }

  function closeCompose() {
    dialog.hidden = true;
    if (dialogBox) dialogBox.style.transform = "";
    editing = null;
    submitting = false;
    dlgSubmit.disabled = false;
    dlgSubmit.textContent = "发布";
    if (dlgTitle) dlgTitle.textContent = "添加注释";
    if (dlgTip) dlgTip.textContent = "发布后，本课所有读者都能看到这条注释。";
  }

  function submitCompose() {
    if (!editing || submitting) return;
    var note = String(dlgNote.value || "").trim();
    if (!note) {
      showError("写点什么再保存吧");
      dlgNote.focus();
      return;
    }
    var name = displayName();
    var snapshot = editing;
    var isEdit = !!snapshot.id;

    submitting = true;
    dlgSubmit.disabled = true;
    dlgSubmit.textContent = isEdit ? "保存中…" : "发布中…";
    if (dlgError) dlgError.hidden = true;

    if (isEdit) {
      api(
        "updateChanAnnotation",
        {
          id: snapshot.id,
          note: note,
          name: name,
          clientId: clientId,
          clientSecret: secret,
        },
        20000
      )
        .then(function (j) {
          submitting = false;
          var d = cache[lessonNo];
          if (d) {
            var i;
            for (i = 0; i < d.list.length; i += 1) {
              if (d.list[i].id === snapshot.id) {
                d.list[i].note = j.note || note;
                d.list[i].name = j.name || name || "匿名读者";
                d.list[i].updatedAt = j.updatedAt || Date.now();
                break;
              }
            }
            d.at = Date.now();
            writeStoredCache(lessonNo, d);
          }
          closeCompose();
          renderAnnotations(lessonNo);
          toast("注释已更新");
        })
        .catch(function (e) {
          submitting = false;
          dlgSubmit.disabled = false;
          dlgSubmit.textContent = submitLabel();
          showError(errorText(e));
        });
      return;
    }

    api(
      "createChanAnnotation",
      {
        lessonNo: lessonNo,
        lessonTitle: lessonTitle,
        quote: snapshot.quote,
        note: note,
        name: name,
        anchor: snapshot.anchor,
        clientId: clientId,
        clientSecret: secret,
      },
      20000
    )
      .then(function (j) {
        submitting = false;
        var item = {
          id: j.id,
          quote: snapshot.quote,
          note: note,
          name: j.name || name || "匿名读者",
          anchor: snapshot.anchor,
          createdAt: j.createdAt || Date.now(),
          updatedAt: 0,
          mine: true,
        };
        var d = cache[lessonNo];
        if (!d) {
          d = { list: [], at: Date.now() };
          cache[lessonNo] = d;
        }
        d.list.unshift(item);
        d.at = Date.now();
        writeStoredCache(lessonNo, d);
        closeCompose();
        clearSelection();
        renderAnnotations(lessonNo);
        // 发布后只保留正文画线和段落入口，不自动展开「本段注释」汇总浮层
        closePop();
        toast("注释已发布");
        locate(item.id);
      })
      .catch(function (e) {
        submitting = false;
        dlgSubmit.disabled = false;
        dlgSubmit.textContent = submitLabel();
        showError(errorText(e));
      });
  }

  /* -------------------------------------------------------------- 事件 */

  if (popClose) popClose.addEventListener("click", closePop);
  if (popRefresh) {
    popRefresh.addEventListener("click", function () {
      loadAnnotations(lessonNo, true);
      if (popOpen) renderPop();
    });
  }

  if (popList) {
    popList.addEventListener("click", function (e) {
      var hit = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!hit) return;
      var item = hit.closest ? hit.closest(".chan-anno-item") : null;
      if (!item) return;
      var id = item.getAttribute("data-id");
      var act = hit.getAttribute("data-act");
      if (act === "locate") {
        // 浮层在窄屏是底部抽屉，先收起再看正文，否则定位到的文字被挡住
        if (window.innerWidth <= 1100) closePop();
        locate(id);
      } else if (act === "edit") {
        openEdit(id);
      } else if (act === "del") {
        removeAnnotation(id);
      }
    });
  }

  if (tip) {
    // 保住选区：按下工具栏不把文字取消选中
    tip.addEventListener("mousedown", function (e) {
      e.preventDefault();
    });
  }
  if (tipBtn) {
    tipBtn.addEventListener("click", function (e) {
      e.preventDefault();
      openCompose();
    });
  }

  if (dlgCancel) dlgCancel.addEventListener("click", closeCompose);
  if (dlgClose) dlgClose.addEventListener("click", closeCompose);
  // 点弹层外面的遮罩不关闭：避免写到一半误点丢失，只能 × / 取消 / Esc
  if (dlgSubmit) dlgSubmit.addEventListener("click", submitCompose);
  if (dlgNote) {
    dlgNote.addEventListener("input", function () {
      if (dlgNoteCount) dlgNoteCount.textContent = String(dlgNote.value.length);
    });
    dlgNote.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitCompose();
      }
    });
  }
  if (dlgName) {
    dlgName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitCompose();
      }
    });
  }

  document.addEventListener("click", function (e) {
    // 写注释弹层是模态的：点外面什么都不关，只能用右上角 × / 取消 / Esc
    if (dialog && !dialog.hidden) return;
    if (!popOpen) return;
    if (pop.contains(e.target)) return;
    var target = e.target;
    // 点段落入口 / 正文标记由它们自己的处理器负责，别在这里又关掉
    if (target.closest && target.closest("button.chan-para-anno")) return;
    if (target.closest && target.closest("mark.chan-anno-hl")) return;
    closePop();
  });

  // 写注释弹层打开时，方向键不能再触发 chan.js 的整课翻页，
  // 否则弹层背后的课会跳走，发布时就把注释写到别的课上了。
  document.addEventListener(
    "keydown",
    function (e) {
      if (!dialog || dialog.hidden) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopPropagation();
      }
    },
    true
  );

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (dialog && !dialog.hidden) {
      closeCompose();
      return;
    }
    if (popOpen) closePop();
    hideTip();
  });

  document.addEventListener("mouseup", function (e) {
    if (tip && tip.contains(e.target)) return;
    scheduleCheck(30);
  });
  document.addEventListener("touchend", function (e) {
    if (tip && tip.contains(e.target)) return;
    scheduleCheck(260);
  });
  document.addEventListener("keyup", function (e) {
    if (e.shiftKey || e.key === "Shift") scheduleCheck(30);
  });

  if (scrollBox) {
    scrollBox.addEventListener("scroll", function () {
      hideTip();
    }, { passive: true });
  }
  window.addEventListener("resize", function () {
    hideTip();
    if (popOpen) placePop();
  });

  // 点正文里的标记 → 展开标记所在段落的浮层，并把这一条滚进视野
  reader.addEventListener("click", function (e) {
    var target = e.target;
    var chip = target.closest ? target.closest("button.chan-para-anno") : null;
    if (chip) {
      var sel0 = window.getSelection();
      if (sel0 && !sel0.isCollapsed) return;
      togglePop(Number(chip.getAttribute("data-pi")));
      return;
    }
    var mark = target.closest ? target.closest("mark.chan-anno-hl") : null;
    if (!mark) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    var id = mark.getAttribute("data-anno");
    var pi = id ? annoHost[id] : undefined;
    if (pi === undefined || !groups[pi]) {
      toast("这条注释的位置有变化，暂时展开不了");
      return;
    }
    openPop(pi, id);
    flashMark(mark);
  });

  // 换课：chan.js 在 show() 里广播
  document.addEventListener("chan:lesson", function (e) {
    var no = e && e.detail ? Number(e.detail.no) : 0;
    if (!no || no === lessonNo) return;
    lessonNo = no;
    lessonTitle = (e.detail && e.detail.title) || "";
    var stored = readStoredCache(no);
    if (stored) cache[no] = stored;
    hideTip();
    closePop();
    groups = [];
    annoHost = {};
    loadAnnotations(no);
  });

  /* -------------------------------------------------------------- 启动 */

  (function init() {
    var sec = activeSection();
    if (!sec) return;
    lessonNo = Number(sec.getAttribute("data-no")) || 1;
    lessonTitle = sec.getAttribute("data-title") || "";
    pruneStoredCaches(lessonNo);
    var stored = readStoredCache(lessonNo);
    if (stored) cache[lessonNo] = stored;
    loadAnnotations(lessonNo);
  })();
})();

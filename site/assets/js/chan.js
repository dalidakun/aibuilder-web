/* 缠论读书会：108 课单页阅读器
   - hash 路由 #l001..#l108，复制地址即可分享单独一课
   - 目录检索（先查标题，标题没命中再查正文）
   - 记住上次读到哪、字号偏大偏小
   页面内容全部是构建时写死的静态 HTML，本脚本只负责显示哪一课。 */
(function () {
  "use strict";

  var reader = document.getElementById("chanReader");
  if (!reader) return;

  var scrollBox = document.getElementById("chanScroll");

  var sections = Array.prototype.slice.call(
    reader.querySelectorAll(".chan-lesson")
  );
  if (!sections.length) return;

  var tocLinks = Array.prototype.slice.call(
    document.querySelectorAll("#chanToc a")
  );
  var tocItems = tocLinks.map(function (a) {
    return a.parentNode;
  });

  var countEl = document.getElementById("chanCount");
  var prevBtn = document.getElementById("chanPrev");
  var nextBtn = document.getElementById("chanNext");
  var resumeBtn = document.getElementById("chanResume");
  var searchEl = document.getElementById("chanSearch");
  var searchBox = document.getElementById("chanSearchBox");
  var searchClear = document.getElementById("chanSearchClear");
  var sideEl = document.getElementById("chanSide");
  var tocBtn = document.getElementById("chanTocBtn");
  var tocScrim = document.getElementById("chanTocScrim");
  var emptyEl = document.getElementById("chanEmpty");
  var fontUp = document.getElementById("chanFontUp");
  var fontDown = document.getElementById("chanFontDown");

  var TOTAL = sections.length;
  var FS_KEY = "chan:fs";
  var LAST_KEY = "chan:last";
  var current = 0;

  function pad(n) {
    return ("00" + n).slice(-3);
  }

  function store(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式里存不了，忽略 */
    }
  }

  function load(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function scrollToTop(smooth) {
    if (scrollBox) {
      scrollBox.scrollTo({
        top: 0,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  }

  function show(no, opts) {
    opts = opts || {};
    no = Math.min(Math.max(no | 0, 1), TOTAL);

    sections.forEach(function (section) {
      section.classList.toggle("is-on", Number(section.dataset.no) === no);
    });

    var activeLink = null;
    tocLinks.forEach(function (a) {
      var on = Number(a.dataset.no) === no;
      if (on) {
        a.setAttribute("aria-current", "true");
        activeLink = a;
      } else {
        a.removeAttribute("aria-current");
      }
    });

    if (activeLink && opts.reveal !== false) {
      var box = activeLink.closest(".chan-toc-wrap");
      if (box) {
        var boxRect = box.getBoundingClientRect();
        var linkRect = activeLink.getBoundingClientRect();
        if (linkRect.top < boxRect.top + 8) {
          box.scrollTop += linkRect.top - boxRect.top - 8;
        } else if (linkRect.bottom > boxRect.bottom - 8) {
          box.scrollTop += linkRect.bottom - boxRect.bottom + 8;
        }
      }
    }

    var lesson = sections[no - 1];
    if (countEl) countEl.textContent = "第 " + no + " / " + TOTAL + " 课";
    if (prevBtn) prevBtn.disabled = no <= 1;
    if (nextBtn) nextBtn.disabled = no >= TOTAL;

    document.title = lesson.dataset.title + " · 缠论读书会";

    if (opts.scroll) scrollToTop(!opts.instant);

    if (opts.save !== false) store(LAST_KEY, String(no));
    current = no;

    // 通知注释模块（assets/js/chan-annotations.js）换课了：
    // 注释按课隔离，切换后要换成这一课的数据。
    try {
      document.dispatchEvent(
        new CustomEvent("chan:lesson", {
          detail: { no: no, title: lesson.dataset.title || "" },
        })
      );
    } catch (e) {}
  }

  function go(no, opts) {
    opts = opts || {};
    if (opts.push !== false) {
      var hash = "#l" + pad(no);
      if (location.hash !== hash) {
        location.hash = hash;
        // hashchange 会再调一次，这里只负责存
        return;
      }
    }
    show(no, opts);
  }

  function readHash() {
    var m = /^#l(\d{1,3})$/.exec(location.hash || "");
    return m ? Number(m[1]) : 0;
  }

  window.addEventListener("hashchange", function () {
    var no = readHash();
    if (!no) return;
    show(no, { scroll: true });
  });

  // 目录 / 翻页链接统一走 hash，浏览器前进后退也就能用
  document.addEventListener("click", function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="#l"]') : null;
    if (!link) return;
    var m = /#l(\d{1,3})$/.exec(link.getAttribute("href"));
    if (!m) return;
    e.preventDefault();
    go(Number(m[1]), { scroll: true });
  });

  /* ---------------- 字号 ---------------- */

  function applyFont(size) {
    size = Math.min(Math.max(size, 14), 23);
    document.body.style.setProperty("--chan-fs", size + "px");
    store(FS_KEY, String(size));
  }

  if (fontUp) {
    fontUp.addEventListener("click", function () {
      var now = parseInt(load(FS_KEY) || "17", 10);
      applyFont(now + 1);
    });
  }
  if (fontDown) {
    fontDown.addEventListener("click", function () {
      var now = parseInt(load(FS_KEY) || "17", 10);
      applyFont(now - 1);
    });
  }
  applyFont(parseInt(load(FS_KEY) || "17", 10));

  /* ---------------- 目录：桌面折叠 / 手机抽屉 ----------------
     桌面：左栏标题栏的按钮把目录整列收起，正文区随之变宽，状态记在 localStorage；
           收起后阅读区左上角浮出「目录」按钮，点它重新展开。
     手机：目录本来是抽屉，标题栏按钮和「目录」按钮都负责开关抽屉。 */

  var layout = document.querySelector(".chan-layout");
  var sideToggle = document.getElementById("chanSideToggle");
  var SIDE_KEY = "chan:side";
  var desktopMq = window.matchMedia("(min-width: 961px)");

  function isDesktop() {
    return desktopMq.matches;
  }

  function sideCollapsed() {
    return !!(layout && layout.classList.contains("is-side-collapsed"));
  }

  function drawerOpen() {
    return !!(sideEl && sideEl.classList.contains("is-open"));
  }

  // 两个按钮的 aria 状态、图标朝向、文案跟着同一份状态走
  function syncSideUi() {
    var desktop = isDesktop();
    var open = desktop ? !sideCollapsed() : drawerOpen();
    if (sideToggle) {
      var label = desktop ? (open ? "收起目录" : "展开目录") : "关闭目录";
      sideToggle.setAttribute("aria-expanded", open ? "true" : "false");
      sideToggle.setAttribute("aria-label", label);
      sideToggle.title = label;
    }
    if (tocBtn) {
      tocBtn.setAttribute("aria-expanded", open ? "true" : "false");
      tocBtn.setAttribute("aria-label", open ? "收起目录" : "展开目录");
      tocBtn.title = open ? "收起目录" : "展开目录";
    }
  }

  function openDrawer() {
    if (!sideEl) return;
    sideEl.classList.add("is-open");
    if (tocScrim) tocScrim.hidden = false;
    syncSideUi();
  }

  function closeDrawer() {
    if (!sideEl) return;
    sideEl.classList.remove("is-open");
    if (tocScrim) tocScrim.hidden = true;
    syncSideUi();
  }

  function expandSide() {
    if (!layout) return;
    layout.classList.remove("is-side-collapsed");
    store(SIDE_KEY, "1");
    syncSideUi();
    // 收起 / 展开后焦点别丢到 body 上，键盘用户能接着操作
    if (sideToggle) sideToggle.focus();
  }

  function collapseSide() {
    if (!layout) return;
    layout.classList.add("is-side-collapsed");
    store(SIDE_KEY, "0");
    syncSideUi();
    if (tocBtn) tocBtn.focus();
  }

  function toggleSide() {
    if (isDesktop()) {
      if (sideCollapsed()) expandSide();
      else collapseSide();
      return;
    }
    if (drawerOpen()) closeDrawer();
    else openDrawer();
  }

  if (sideToggle) sideToggle.addEventListener("click", toggleSide);
  if (tocBtn) tocBtn.addEventListener("click", toggleSide);
  if (tocScrim) tocScrim.addEventListener("click", closeDrawer);
  if (sideEl) {
    sideEl.addEventListener("click", function (e) {
      var link = e.target.closest ? e.target.closest('a[href^="#l"]') : null;
      // 手机上点完目录顺手收起抽屉；桌面折叠态点不到这里
      if (link && !isDesktop()) closeDrawer();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && drawerOpen()) closeDrawer();
  });

  // 跨断点时把另一套状态清干净：进桌面丢掉抽屉，进手机丢掉折叠
  function onBreakpoint() {
    if (!layout) return;
    if (isDesktop()) {
      if (sideEl) sideEl.classList.remove("is-open");
      if (tocScrim) tocScrim.hidden = true;
      if (load(SIDE_KEY) === "0") layout.classList.add("is-side-collapsed");
      else layout.classList.remove("is-side-collapsed");
    } else {
      layout.classList.remove("is-side-collapsed");
    }
    syncSideUi();
  }
  if (desktopMq.addEventListener) desktopMq.addEventListener("change", onBreakpoint);
  else if (desktopMq.addListener) desktopMq.addListener(onBreakpoint);

  // 桌面按上次的选择还原目录；手机上目录一律先是收起的抽屉
  if (layout && isDesktop() && load(SIDE_KEY) === "0") {
    layout.classList.add("is-side-collapsed");
  }
  syncSideUi();

  /* ---------------- 检索（只搜标题） ---------------- */

  var searchTimer = 0;

  function filter() {
    if (!searchEl) return;
    var q = searchEl.value.trim().toLowerCase();
    var hits = 0;

    tocItems.forEach(function (item, i) {
      var link = tocLinks[i];
      var hit = !q || (link.dataset.search || "").indexOf(q) !== -1;
      item.hidden = !hit;
      if (hit) hits += 1;
    });

    if (emptyEl) emptyEl.hidden = hits !== 0;
    if (countEl && q) countEl.textContent = "匹配 " + hits + " 课";
    else if (countEl && current) countEl.textContent = "第 " + current + " / " + TOTAL + " 课";
  }

  function syncSearchClear() {
    if (searchClear && searchEl) searchClear.hidden = !searchEl.value;
  }

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      syncSearchClear();
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(filter, 120);
    });
    searchEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = tocItems.filter(function (item) {
          return !item.hidden;
        })[0];
        if (first) {
          var no = Number(first.querySelector("a").dataset.no);
          go(no, { scroll: true });
        }
      }
    });
    syncSearchClear();
  }

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      if (!searchEl) return;
      searchEl.value = "";
      syncSearchClear();
      window.clearTimeout(searchTimer);
      filter();
      searchEl.focus();
    });
  }

  // 点搜索框空白处 / 放大镜都聚焦到输入框
  if (searchBox && searchEl) {
    searchBox.addEventListener("click", function (e) {
      if (e.target === searchClear || e.target === searchEl) return;
      searchEl.focus();
    });
  }

  /* ---------------- 键盘翻页 ---------------- */

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(Math.min(current + 1, TOTAL), { scroll: true });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(Math.max(current - 1, 1), { scroll: true });
    }
  });

  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      go(Math.max(current - 1, 1), { scroll: true });
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      go(Math.min(current + 1, TOTAL), { scroll: true });
    });
  }

  /* ---------------- 右下角 DeepSeek ---------------- */

  (function () {
    var fab = document.getElementById("chanAiFab");
    if (!fab) return;
    var DEEPSEEK_URL = "https://chat.deepseek.com/";

    // 点一次直接打开官方网页版：独立 440×720 窗口，不是新标签，阅读页不跳走。
    fab.addEventListener("click", function (e) {
      e.stopPropagation();
      var w = 440;
      var h = 720;
      var left = Math.max(0, (window.screenX || 0) + window.innerWidth - w - 40);
      var top = Math.max(0, (window.screenY || 0) + 80);
      var win = null;
      try {
        win = window.open(
          DEEPSEEK_URL,
          "deepseek_web_chat",
          "popup=yes,width=" + w + ",height=" + h + ",left=" + left + ",top=" + top
        );
      } catch (err) {}
      try {
        if (win) win.opener = null;
      } catch (err2) {}
      if (!win) {
        // 浏览器拦截弹窗时退到当前标签，不新开标签
        try {
          window.location.href = DEEPSEEK_URL;
        } catch (err3) {}
      }
    });
  })();

  /* ---------------- 启动 ---------------- */

  var last = parseInt(load(LAST_KEY) || "0", 10);
  if (resumeBtn && last > 1) {
    resumeBtn.textContent = "继续上次：第 " + last + " 课";
    resumeBtn.setAttribute("href", "#l" + pad(last));
  }

  var initialHash = readHash();
  var start = initialHash || (last >= 1 ? last : 1);
  show(start, { instant: true });
  scrollToTop(false);
})();

/* 缠论读书会 · 教学白板（chan-whiteboard.js）
   ---------------------------------------------------------------------------
   右上角「白板」按钮打开一块整屏教学白板：
   - 画笔 / 荧光笔 / 橡皮 / 直线 / 箭头 / 矩形 / 椭圆 / 文字 / 激光笔 / 插图
   - 无限画布：空格或中键拖动平移，Ctrl+滚轮或双指缩放，0 一键适应内容
   - 一块连续白板：上有顶部、左、右边界，向下无限延伸，不分页
   - 背景（白板 / 黑板 / 米黄纸 / 方格 / 点阵 / 横线）
   - 圈选一片画线后整体拖动，选择、移动、缩放图片、复制、删除、撤销 / 重做
   - 所有改动自动存进 localStorage；另可导出 PNG、保存 / 打开工程 JSON
   纯前端，不依赖任何接口；图片先压成 WebP data URL 再存本地。 */
(function () {
  "use strict";

  var root = document.getElementById("cwb");
  var stage = document.getElementById("cwbStage");
  var base = document.getElementById("cwbBase");
  var live = document.getElementById("cwbLive");
  if (!root || !stage || !base || !live) return;
  if (!base.getContext || !live.getContext) return;

  var bctx = base.getContext("2d");
  var lctx = live.getContext("2d");

  function byId(id) {
    return document.getElementById(id);
  }

  var el = {
    open: byId("cwbOpen"),
    close: byId("cwbClose"),
    undo: byId("cwbUndo"),
    redo: byId("cwbRedo"),
    saved: byId("cwbSaved"),
    fileBtn: byId("cwbFileBtn"),
    fileMenu: byId("cwbFileMenu"),
    imageMenu: byId("cwbImageMenu"),
    helpBtn: byId("cwbHelpBtn"),
    help: byId("cwbHelp"),
    helpClose: byId("cwbHelpClose"),
    focusBtn: byId("cwbFocusBtn"),
    unfocus: byId("cwbUnfocus"),
    title: byId("cwbTitle"),
    titleInput: byId("cwbTitleInput"),
    tools: byId("cwbTools"),
    colors: byId("cwbColors"),
    colorBtn: byId("cwbColorBtn"),
    colorMenu: byId("cwbColorMenu"),
    colorDot: byId("cwbColorDot"),
    widths: byId("cwbWidths"),
    fillBtn: byId("cwbFillBtn"),
    bgs: byId("cwbBgs"),
    bgToggle: byId("cwbBgToggle"),
    extendBtn: byId("cwbExtendBtn"),
    sizeMenu: byId("cwbSizeMenu"),
    sizeName: byId("cwbSizeName"),
    sizeVal: byId("cwbSizeVal"),
    sizeRange: byId("cwbSizeRange"),
    textEdit: byId("cwbTextEdit"),
    toTop: byId("cwbToTop"),
    toBottom: byId("cwbToBottom"),
    scrollNav: byId("cwbScrollNav"),
    toast: byId("cwbToast"),
    toastText: byId("cwbToastText"),
    toastAct: byId("cwbToastAct"),
    confirm: byId("cwbConfirm"),
    confirmTitle: byId("cwbConfirmTitle"),
    confirmText: byId("cwbConfirmText"),
    confirmOk: byId("cwbConfirmOk"),
    confirmCancel: byId("cwbConfirmCancel"),
    importInput: byId("cwbImportInput"),
    imageInput: byId("cwbImageInput")
  };
  if (!el.open) return;

  /* ------------------------------- 常量 ------------------------------- */

  var STORAGE_KEY = "chan:wb:v1";
  var SAVE_DELAY = 650;
  var MAX_HISTORY = 100;
  var TEXT_WRAP = 560;
  var TEXT_PAD = 6;
  var FONT_STACK =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ' +
    '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif';
  var TAU = Math.PI * 2;

  var COLORS = [
    { hex: "#1f2937", name: "墨黑" },
    { hex: "#e74c3c", name: "朱红" },
    { hex: "#27ae60", name: "翠绿" },
    { hex: "#2980b9", name: "靛蓝" },
    { hex: "#f39c12", name: "橙黄" },
    { hex: "#9b59b6", name: "紫" },
    { hex: "#ec4899", name: "粉" },
    { hex: "#ffffff", name: "白" }
  ];

  var WIDTHS = [2, 4, 7, 11];
  var DEFAULT_TOOL_WIDTHS = {
    pen: 4,
    highlighter: 7,
    eraser: 7,
    line: 4,
    arrow: 4,
    rect: 4,
    ellipse: 4,
    text: 2
  };
  var toolWidths = {};
  Object.keys(DEFAULT_TOOL_WIDTHS).forEach(function (k) {
    toolWidths[k] = DEFAULT_TOOL_WIDTHS[k];
  });
  var textSizeCustomized = false;
  var SIZE_WHEEL_TOOLS = {
    pen: 1,
    highlighter: 1,
    eraser: 1,
    line: 1,
    arrow: 1,
    rect: 1,
    ellipse: 1
  };
  var wheelSizeAcc = 0;
  var imageWheelState = { id: "", at: 0, acc: 0 };
  var placingGap = false;
  var sizeMenuTool = null;
  var sizeMenuTextFired = false;
  var textAutoPanning = false;

  var THEMES = [
    {
      id: "white",
      name: "白板",
      fill: "#fffdf7",
      ink: "#1f2937",
      grid: "none",
      gridColor: "rgba(60, 50, 30, 0.11)",
      step: 48,
      dark: false
    },
    {
      id: "black",
      name: "黑板",
      fill: "#22302a",
      ink: "#f7f4ec",
      grid: "none",
      gridColor: "rgba(255, 255, 255, 0.06)",
      step: 48,
      dark: true
    },
    {
      id: "paper",
      name: "米黄",
      fill: "#f7efdc",
      ink: "#2a2419",
      grid: "none",
      gridColor: "rgba(60, 50, 30, 0.08)",
      step: 48,
      dark: false
    },
    {
      id: "sage",
      name: "浅绿",
      fill: "#e8f0e5",
      ink: "#1f2937",
      grid: "none",
      gridColor: "rgba(48, 92, 56, 0.08)",
      step: 48,
      dark: false
    },
    {
      id: "mist",
      name: "浅蓝",
      fill: "#e7eef5",
      ink: "#1f2937",
      grid: "none",
      gridColor: "rgba(48, 70, 100, 0.08)",
      step: 48,
      dark: false
    },
    {
      id: "stone",
      name: "浅灰",
      fill: "#eceef0",
      ink: "#1f2937",
      grid: "none",
      gridColor: "rgba(50, 55, 60, 0.08)",
      step: 48,
      dark: false
    },
    {
      id: "grid",
      name: "方格",
      fill: "#fffdf7",
      ink: "#1f2937",
      grid: "grid",
      gridColor: "rgba(48, 92, 56, 0.14)",
      step: 40,
      dark: false
    },
    {
      id: "dot",
      name: "点阵",
      fill: "#fbfaf6",
      ink: "#1f2937",
      grid: "dot",
      gridColor: "rgba(48, 92, 56, 0.2)",
      step: 32,
      dark: false
    },
    {
      id: "ruled",
      name: "横线",
      fill: "#fffdf7",
      ink: "#1f2937",
      grid: "ruled",
      gridColor: "rgba(48, 92, 56, 0.13)",
      step: 44,
      dark: false
    }
  ];
  var BG_THEME_IDS = ["white", "black"];
  var OLD_BG_MAP = {
    grid: "white",
    dot: "white",
    ruled: "white",
    paper: "white",
    sage: "white",
    mist: "white",
    stone: "white"
  };

  function svg(paths) {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"' +
      ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      "</svg>"
    );
  }

  var TOOLS = [
    {
      id: "select",
      name: "选择 / 移动",
      key: "V",
      icon: svg('<path d="m6 4.2 11.4 7.1-5.1 1.3-1.6 5z"/>')
    },
    {
      id: "lasso",
      name: "圈选 / 整体拖动",
      key: "C",
      title: "圈选：圈住一片画线，再按 V / 直接拖动整体移动（C）",
      icon: svg(
        '<path d="M7 22a5 5 0 0 1-2-4"/>' +
          '<path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/>' +
          '<circle cx="5" cy="16" r="2"/>'
      )
    },
    {
      id: "pen",
      name: "画笔",
      key: "P",
      icon: svg(
        '<path d="M4.5 19.5 5.8 15 16.6 4.2a2 2 0 0 1 2.8 2.8L8.6 17.8z"/>' +
          '<path d="m14.6 6.2 3.2 3.2"/>'
      )
    },
    {
      id: "highlighter",
      name: "荧光笔",
      key: "H",
      icon: svg(
        '<path d="m8.4 14.6-3.1 3.1 1 1 3.1-3.1"/>' +
          '<path d="M10.2 12.6 16 6.8a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8l-5.8 5.8z"/>' +
          '<path d="M11 20.2h8.5"/>'
      )
    },
    {
      id: "eraser",
      name: "橡皮（按住拖动擦）",
      key: "E",
      icon: svg(
        '<path d="m4.8 14.9 8.4-8.4a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8l-5.6 5.6H8.3z"/>' +
          '<path d="m9.4 18.2-3.4-3.4"/>'
      )
    },
    {
      id: "line",
      name: "直线",
      key: "L",
      icon: svg('<path d="M5 19 19 5"/>')
    },
    {
      id: "arrow",
      name: "箭头",
      key: "A",
      icon: svg('<path d="M5 19 19 5"/><path d="M12.4 5H19v6.6"/>')
    },
    {
      id: "rect",
      name: "矩形",
      key: "R",
      icon: svg('<rect x="4.5" y="6" width="15" height="12" rx="1.5"/>')
    },
    {
      id: "ellipse",
      name: "椭圆",
      key: "O",
      icon: svg('<ellipse cx="12" cy="12" rx="7.6" ry="6"/>')
    },
    {
      id: "text",
      name: "文字",
      key: "T",
      icon: svg(
        '<path d="M5 6.5h14"/><path d="M12 6.5v12"/><path d="M9 18.5h6"/>'
      )
    },
    {
      id: "laser",
      name: "激光笔（不保存）",
      key: "K",
      icon: svg(
        '<circle cx="12" cy="12" r="2.1"/>' +
          '<path d="M12 3.6v2.7M12 17.7v2.7M3.6 12h2.7M17.7 12h2.7"/>' +
          '<path d="m6.1 6.1 1.9 1.9M16 16l1.9 1.9M17.9 6.1 16 8M8 16l-1.9 1.9"/>'
      )
    },
    {
      id: "hand",
      name: "拖动画布",
      key: "Space",
      icon: svg(
        '<path d="M8.2 11.6V6.9a1.5 1.5 0 0 1 3 0v4.1"/>' +
          '<path d="M11.2 10.5V5.7a1.5 1.5 0 0 1 3 0v4.8"/>' +
          '<path d="M14.2 10.8V7.1a1.5 1.5 0 0 1 3 0v6.3c0 4.1-2.6 6.6-6.1 6.6-2.4 0-4-1.2-5.2-3l-1.9-3a1.6 1.6 0 0 1 2.6-1.9l1.9 2.1"/>'
      )
    },
    {
      id: "image",
      name: "插入图片",
      action: "image",
      icon: svg(
        '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/>' +
          '<circle cx="8.6" cy="9.4" r="1.4"/>' +
          '<path d="m5.2 17.2 4.6-4.6 3 3 2.5-2.5 4.2 4.1"/>'
      )
    }
  ];

  /* ------------------------------- 状态 ------------------------------- */

  var isOpen = false;
  var loaded = false;
  var lastFocus = null;
  var doc = null;
  var page = null;
  var tool = "pen";
  var color = "#1f2937";
  var width = 4;
  var fillShape = false;
  var selectedId = null;
  var lassoIds = [];
  var lastTextId = null;
  var histories = {};
  var draft = null;
  var action = null;
  var pointers = {};
  var pinchState = null;
  var spaceDown = false;
  var lastPenAt = 0;
  var hoverPoint = null;
  var laser = { points: [], raf: 0 };
  var textState = null;
  var saveTimer = 0;
  var dirty = false;
  var quotaWarnAt = 0;
  var toastTimer = 0;
  var confirmState = null;
  var titleEditing = false;
  var closeTimer = 0;
  var imageCache = {};
  var imageClipboard = null;
  var imageMenuAt = null;
  var view = { w: 0, h: 0, dpr: 1 };
  var resizeRaf = 0;

  var measure = document.createElement("canvas");
  var measureCtx = measure.getContext("2d");
  var contentCanvas = null;
  var contentCtx = null;

  /* ------------------------------ 小工具 ------------------------------ */

  function clamp(n, lo, hi) {
    return Math.min(Math.max(n, lo), hi);
  }

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function cloneObject(o) {
    var c = {};
    for (var k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    }
    if (o.points) {
      c.points = o.points.map(function (p) {
        return { x: p.x, y: p.y };
      });
    }
    if (o.lines) c.lines = o.lines.slice();
    return c;
  }

  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return THEMES[0];
  }

  function theme() {
    return themeById(page ? page.bg : "white");
  }

  function hexRgb(hex) {
    if (typeof hex !== "string") return { r: 31, g: 41, b: 55 };
    var h = hex.replace("#", "");
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 31, g: 41, b: 55 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function luminance(hex) {
    var c = hexRgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }

  function rgbToHsl(c) {
    var r = c.r / 255;
    var g = c.g / 255;
    var b = c.b / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var l = (max + min) / 2;
    var s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return { h: h, s: clamp(s, 0, 1), l: l };
  }

  function hslToHex(h, s, l) {
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((h % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0;
    var g = 0;
    var b = 0;
    if (hp < 1) {
      r = c;
      g = x;
    } else if (hp < 2) {
      r = x;
      g = c;
    } else if (hp < 3) {
      g = c;
      b = x;
    } else if (hp < 4) {
      g = x;
      b = c;
    } else if (hp < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    var m = l - c / 2;
    function to(n) {
      var v = Math.round((n + m) * 255);
      return (v < 16 ? "0" : "") + clamp(v, 0, 255).toString(16);
    }
    return "#" + to(r) + to(g) + to(b);
  }

  /* 换背景时把「会看不见」的笔画调到看得见：黑/白/灰直接换成主题墨色，
     彩色保留色相、只调亮（进黑板）或调暗（回浅色），红绿蓝的区分不会丢。 */
  function adaptInkColor(hex, th) {
    var c = hexRgb(hex);
    var max = Math.max(c.r, c.g, c.b);
    var min = Math.min(c.r, c.g, c.b);
    var chroma = max - min;
    var lum = luminance(hex);
    if (th.dark && lum < 0.42) {
      if (chroma <= 40) return th.ink;
      var dark = rgbToHsl(c);
      return hslToHex(dark.h, dark.s, 0.74);
    }
    if (!th.dark && lum > 0.82) {
      if (chroma <= 30) return th.ink;
      var light = rgbToHsl(c);
      return hslToHex(light.h, light.s, 0.42);
    }
    return hex;
  }

  function formatClock(ts) {
    var d = new Date(ts || Date.now());
    function p(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function stamp() {
    var d = new Date();
    function p(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      "-" +
      p(d.getHours()) +
      p(d.getMinutes())
    );
  }

  function safeName(s) {
    var out = String(s || "白板")
      .replace(/[\\/:*?"<>|]/g, "")
      .slice(0, 40)
      .trim();
    return out || "白板";
  }

  function activePage() {
    if (!doc) return null;
    for (var i = 0; i < doc.pages.length; i++) {
      if (doc.pages[i].id === doc.activeId) return doc.pages[i];
    }
    return doc.pages[0] || null;
  }

  function findObject(id) {
    if (!page || !id) return null;
    for (var i = 0; i < page.objects.length; i++) {
      if (page.objects[i].id === id) return page.objects[i];
    }
    return null;
  }

  function objectIndex(id) {
    if (!page) return -1;
    for (var i = 0; i < page.objects.length; i++) {
      if (page.objects[i].id === id) return i;
    }
    return -1;
  }

  function screenPoint(e) {
    var r = live.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function worldPoint(e) {
    var p = screenPoint(e);
    var c = page.cam;
    var wx = (p.x - c.x) / c.scale;
    var wy = (p.y - c.y) / c.scale;
    var W = boardWidth();
    // 画布有上 / 左 / 右边界：绘制与选择坐标都收在画板内
    if (wx < 0) wx = 0;
    else if (wx > W) wx = W;
    return { x: wx, y: wy < 0 ? 0 : wy };
  }

  function worldOfScreen(sx, sy) {
    var c = page.cam;
    return { x: (sx - c.x) / c.scale, y: (sy - c.y) / c.scale };
  }

  function clampCameraY() {
    if (!page || !page.cam) return;
    if (!isFinite(page.cam.y) || page.cam.y > 0) page.cam.y = 0;
  }

  function boardWidth() {
    if (!page) return 0;
    if (page.width && page.width > 0) return page.width;
    if (view.w > 2) return view.w;
    return 1000;
  }

  function textWrapWidthFor(width) {
    width = Number(width) || view.w || 800;
    return Math.max(120, Math.min(TEXT_WRAP - 8, width - 24));
  }

  function textWrapWidth() {
    return textWrapWidthFor(boardWidth());
  }

  /* 左右边界：画板宽度在第一次打开时按当前屏幕宽度定下来。
     缩放后如果画板比屏幕窄就居中；比屏幕宽则只允许在画板左右边缘之间平移。 */
  function clampCameraX() {
    if (!page || !page.cam || view.w < 2) return;
    var total = boardWidth() * page.cam.scale;
    if (total >= view.w) {
      var min = view.w - total;
      if (!isFinite(page.cam.x)) page.cam.x = 0;
      if (page.cam.x < min) page.cam.x = min;
      if (page.cam.x > 0) page.cam.x = 0;
    } else {
      page.cam.x = (view.w - total) / 2;
    }
  }

  function clampCamera() {
    clampCameraY();
    clampCameraX();
  }

  function ensureBoardWidth() {
    if (!page || view.w < 2) return false;
    // 画布宽度 = 屏幕宽度（舞台宽度），不再保留更宽的历史画板
    var target = Math.max(240, view.w);
    if (!isFinite(page.width) || Math.abs(page.width - target) > 0.5) {
      page.width = target;
      rewrapPageText(page);
      return true;
    }
    return false;
  }

  /* 画布宽度永远等于当前屏幕宽度；不保留历史更宽的板，也不做横向平移。
     窗口变小时，文字 / 图片 / 整组附注 / 笔迹都收进屏幕宽度内。 */
  function rewrapPageText(p) {
    if (!p || !p.width) return;
    var W = p.width;
    var maxW = Math.max(80, W - 24);
    var objects = p.objects;
    var index = {};
    var i;
    for (i = 0; i < objects.length; i++) index[objects[i].id] = i;

    function replaceAt(idx, obj) {
      objects[idx] = obj;
    }

    function moveList(list, dx) {
      for (var k = 0; k < list.length; k++) {
        var idx = index[list[k].id];
        if (idx == null) continue;
        replaceAt(idx, translateObject(list[k], dx, 0));
      }
    }

    function scaleList(list, ox, oy, sx, sy) {
      var out = [];
      for (var k = 0; k < list.length; k++) {
        var idx = index[list[k].id];
        if (idx == null) continue;
        var c = scaleObjectAbout(list[k], ox, oy, sx, sy);
        replaceAt(idx, c);
        out.push(c);
      }
      return out;
    }

    for (i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (o.parentId && index[o.parentId] != null) continue;
      if (o.type === "text") {
        if (!o.w || !o.h) initTextBox(o, W);
        o.w = Math.min(o.w || maxW, maxW);
        o.manual = true;
        relayoutTextBox(o);
        if (o.x < 0) o.x = 0;
        if (o.x + o.w > W) o.x = Math.max(0, W - o.w);
        continue;
      }
      if (o.type === "image") {
        var list = [o];
        for (var j = 0; j < objects.length; j++) {
          if (objects[j].parentId === o.id) list.push(objects[j]);
        }
        var gb = groupBounds(list);
        if (gb.w > W) {
          var s = W / gb.w;
          list = scaleList(list, gb.x, gb.y, s, s);
          gb = groupBounds(list);
        }
        if (gb.w <= W) {
          var dx = 0;
          if (gb.x < 0) dx = -gb.x;
          else if (gb.x + gb.w > W) dx = W - gb.x - gb.w;
          if (dx) moveList(list, dx);
        }
        continue;
      }
      if (
        o.type === "pen" ||
        o.type === "highlighter" ||
        o.type === "eraser" ||
        o.type === "line" ||
        o.type === "arrow" ||
        o.type === "rect" ||
        o.type === "ellipse"
      ) {
        var b = objectBounds(o);
        if (b.w > W) {
          replaceAt(i, scaleObjectAbout(o, b.x, o.y, W / b.w, 1));
        } else {
          var d = 0;
          if (b.x < 0) d = -b.x;
          else if (b.x + b.w > W) d = W - b.x - b.w;
          if (d) replaceAt(i, translateObject(o, d, 0));
        }
      }
    }
  }

  function setSaved(kind, text) {
    if (el.saved) {
      el.saved.className =
        "cwb-saved" +
        (kind === "saving" ? " is-saving" : "") +
        (kind === "error" ? " is-error" : "");
      el.saved.textContent = text;
      el.saved.title = text;
    }
  }

  function showToast(message, actionLabel, actionFn, ms) {
    if (!el.toast) return;
    window.clearTimeout(toastTimer);
    el.toastText.textContent = message;
    if (actionLabel && actionFn) {
      el.toastAct.hidden = false;
      el.toastAct.textContent = actionLabel;
      el.toastAct.onclick = function () {
        hideToast();
        try {
          actionFn();
        } catch (err) {
          /* 回调失败不打断白板 */
        }
      };
    } else {
      el.toastAct.hidden = true;
      el.toastAct.onclick = null;
    }
    el.toast.hidden = false;
    toastTimer = window.setTimeout(hideToast, ms || 3600);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    if (el.toast) el.toast.hidden = true;
  }

  /* ------------------------------- 背景 ------------------------------- */

  function buildBgSwatches() {
    if (!el.bgs) return;
    el.bgs.innerHTML = "";
    THEMES.forEach(function (th) {
      if (BG_THEME_IDS.indexOf(th.id) === -1) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cwb-bgdot";
      b.dataset.bg = th.id;
      b.style.backgroundColor = th.fill;
      b.title = "背景：" + th.name;
      b.setAttribute("aria-label", "背景：" + th.name);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        setTheme(th.id);
      });
      el.bgs.appendChild(b);
    });
  }

  function syncThemeUi() {
    if (!page) return;
    var dark = theme().dark;
    root.classList.toggle("is-dark-bg", dark);
    if (el.bgs) {
      var items = el.bgs.querySelectorAll("[data-bg]");
      for (var i = 0; i < items.length; i++) {
        var on = items[i].dataset.bg === page.bg;
        items[i].classList.toggle("is-on", on);
        items[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    if (el.bgToggle) {
      el.bgToggle.classList.toggle("is-dark", dark);
      el.bgToggle.setAttribute("aria-pressed", dark ? "true" : "false");
      el.bgToggle.title = dark ? "切换到白板" : "切换到黑板";
      el.bgToggle.setAttribute(
        "aria-label",
        dark ? "切换到白板" : "切换到黑板"
      );
    }
  }

  function setTheme(id) {
    if (!page) return;
    var th = themeById(id);
    if (!th || page.bg === id) return;
    // 换背景也进历史：撤销时连背景和自动调色的笔画一起回去
    pushHistory();
    var recolored = recolorPageInk(th);
    page.bg = id;
    var nextInk = adaptInkColor(color, th);
    if (nextInk !== color) setColor(nextInk, { recolor: false });
    syncThemeUi();
    drawAll();
    drawLive();
    markDirty();
    if (th.dark) {
      showToast(
        recolored
          ? "已切换到黑板，深色笔画自动调亮了"
          : "已切换到黑板：白色粉笔色更好看"
      );
    } else if (recolored) {
      showToast("已切回浅色背景，浅色笔画自动调暗了");
    }
  }

  /* 切到黑板时，原来接近黑色的笔画会看不清；切回浅色时白色笔画同理。
     黑白灰直接换成主题墨色，彩色保留色相、只调明度（黑板调亮、白板调暗）。
     改之前先存一份历史，所以整块调色也能 Ctrl+Z 撤回。 */
  function recolorPageInk(th) {
    var changed = false;
    var next = page.objects.map(function (o) {
      if (o.type === "eraser") return o;
      var target = adaptInkColor(o.color, th);
      if (target.toLowerCase() === o.color.toLowerCase()) return o;
      changed = true;
      var copy = cloneObject(o);
      copy.color = target;
      return copy;
    });
    if (!changed) return false;
    page.objects = next;
    return true;
  }

  /* ------------------------------ 画布渲染 ------------------------------ */

  function resize() {
    if (!page) return;
    var r = stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    view.w = r.width;
    view.h = r.height;
    view.dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    var pw = Math.max(1, Math.round(view.w * view.dpr));
    var ph = Math.max(1, Math.round(view.h * view.dpr));
    if (base.width !== pw || base.height !== ph) {
      base.width = pw;
      base.height = ph;
    }
    if (live.width !== pw || live.height !== ph) {
      live.width = pw;
      live.height = ph;
    }
    bctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    lctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    var gotWidth = ensureBoardWidth();
    clampCamera();
    if (gotWidth) markDirty();
  }

  function drawGrid(ctx) {
    var th = theme();
    var c = page.cam;
    if (th.grid === "none") return;
    var step = th.step * c.scale;
    if (step < 8) return;
    var ox = c.x % step;
    var oy = c.y % step;
    if (ox > 0) ox -= step;
    if (oy > 0) oy -= step;
    ctx.save();
    ctx.strokeStyle = th.gridColor;
    ctx.fillStyle = th.gridColor;
    ctx.lineWidth = 1;
    var x;
    var y;
    if (th.grid === "dot") {
      var rr = Math.max(0.8, 1.15 * Math.min(1.3, c.scale));
      for (x = ox; x < view.w + step; x += step) {
        for (y = oy; y < view.h + step; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, TAU);
          ctx.fill();
        }
      }
    } else if (th.grid === "ruled") {
      for (y = oy; y < view.h + step; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(view.w, y);
        ctx.stroke();
      }
    } else {
      for (x = ox; x < view.w + step; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, view.h);
        ctx.stroke();
      }
      for (y = oy; y < view.h + step; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(view.w, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawBackground(ctx) {
    var th = theme();
    var c = page.cam;
    var bx = c.x;
    var bw = boardWidth() * c.scale;
    var by = c.y;
    ctx.fillStyle = th.fill;
    ctx.fillRect(0, 0, view.w, view.h);
    // 网格只铺在画板宽度以内，左右边界外留白，边界一眼可见
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, view.h - by);
    ctx.clip();
    drawGrid(ctx);
    ctx.restore();
    if (th.dark) {
      var g = ctx.createRadialGradient(
        view.w * 0.5,
        view.h * 0.42,
        Math.min(view.w, view.h) * 0.12,
        view.w * 0.5,
        view.h * 0.5,
        Math.max(view.w, view.h) * 0.78
      );
      g.addColorStop(0, "rgba(255,255,255,0.035)");
      g.addColorStop(0.65, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.26)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    // 画板比视口窄时（缩得很小 / 换了大屏），把左右留白压暗，边界一眼可见
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = th.dark ? "rgba(0,0,0,.3)" : "rgba(36,31,22,.07)";
    if (bx > 0) ctx.fillRect(0, 0, bx, view.h);
    if (bx + bw < view.w) ctx.fillRect(bx + bw, 0, view.w - (bx + bw), view.h);
    ctx.restore();
    // 顶部 / 左右边界只留很淡的内阴影，不再画深色实线
    ctx.save();
    var edge = th.dark ? "rgba(247,244,236,0.075)" : "rgba(36,31,22,0.05)";
    var edge0 = th.dark ? "rgba(247,244,236,0)" : "rgba(36,31,22,0)";
    var eg;
    if (bx >= 0 && bx < view.w) {
      eg = ctx.createLinearGradient(bx, 0, bx + 14, 0);
      eg.addColorStop(0, edge);
      eg.addColorStop(1, edge0);
      ctx.fillStyle = eg;
      ctx.fillRect(bx, 0, 14, view.h);
    }
    if (bx + bw > 0 && bx + bw <= view.w) {
      eg = ctx.createLinearGradient(bx + bw - 14, 0, bx + bw, 0);
      eg.addColorStop(0, edge0);
      eg.addColorStop(1, edge);
      ctx.fillStyle = eg;
      ctx.fillRect(bx + bw - 14, 0, 14, view.h);
    }
    if (by >= 0 && by < view.h) {
      eg = ctx.createLinearGradient(0, by, 0, by + 12);
      eg.addColorStop(0, edge);
      eg.addColorStop(1, edge0);
      ctx.fillStyle = eg;
      ctx.fillRect(bx, by, Math.max(0, bw), 12);
    }
    ctx.restore();
  }

  function applyCamera(ctx) {
    var c = page.cam;
    ctx.translate(c.x, c.y);
    ctx.scale(c.scale, c.scale);
  }

  function drawAll() {
    if (!page || !view.w) return;
    bctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    bctx.clearRect(0, 0, view.w, view.h);
    drawBackground(bctx);

    var hasEraser = false;
    for (var e = 0; e < page.objects.length; e++) {
      if (page.objects[e].type === "eraser") {
        hasEraser = true;
        break;
      }
    }
    var hideId = textState && textState.original ? textState.original.id : "";
    function paint(ctx) {
      ctx.save();
      applyCamera(ctx);
      for (var i = 0; i < page.objects.length; i++) {
        if (hideId && page.objects[i].id === hideId) continue;
        drawObject(ctx, page.objects[i]);
      }
      ctx.restore();
    }
    if (hasEraser) {
      // 橡皮是 destination-out：在独立的内容层擦出透明洞，再叠到完整纸底上，
      // 这样网格 / 边界不会被擦掉，擦除处露出的仍是原来的纸面。
      if (!contentCanvas) {
        contentCanvas = document.createElement("canvas");
        contentCtx = contentCanvas.getContext("2d");
      }
      if (contentCanvas.width !== base.width || contentCanvas.height !== base.height) {
        contentCanvas.width = base.width;
        contentCanvas.height = base.height;
      }
      contentCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      contentCtx.clearRect(0, 0, view.w, view.h);
      paint(contentCtx);
      bctx.drawImage(contentCanvas, 0, 0, view.w, view.h);
    } else {
      paint(bctx);
    }
    if (textState) positionText();
    syncScrollNav();
  }

  function bottomCamY() {
    if (!page) return 0;
    var b = contentBounds();
    if (!b) return 0;
    var margin = Math.min(110, Math.max(60, view.h * 0.16));
    return Math.min(0, view.h - margin - (b.y + b.h));
  }

  function syncScrollNav() {
    if (!el.toTop || !el.toBottom || !el.scrollNav) return;
    el.scrollNav.classList.toggle("is-dark", theme().dark);
    var topHidden = !(page && page.cam && page.cam.y < -8);
    var target = bottomCamY();
    var bottomHidden = !(page && page.cam && page.cam.y > target + 8);
    el.toTop.hidden = topHidden;
    el.toBottom.hidden = bottomHidden;
    el.scrollNav.hidden = topHidden && bottomHidden;
  }

  function scrollToTop() {
    if (!page) return;
    if (textState) commitText();
    page.cam.y = 0;
    clampCamera();
    drawAll();
    drawLive();
    markDirty();
  }

  function scrollToBottom() {
    if (!page) return;
    if (textState) commitText();
    page.cam.y = bottomCamY();
    clampCamera();
    drawAll();
    drawLive();
    markDirty();
  }

  function drawStroke(ctx, points, lineWidth) {
    if (!points || !points.length) return;
    ctx.lineWidth = lineWidth;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, Math.max(0.8, lineWidth / 2), 0, TAU);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (var i = 1; i < points.length - 1; i++) {
        var mx = (points[i].x + points[i + 1].x) / 2;
        var my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      var last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
  }

  function normRect(o) {
    var x = Math.min(o.x1, o.x2);
    var y = Math.min(o.y1, o.y2);
    return { x: x, y: y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
  }

  function drawArrow(ctx, o) {
    var x1 = o.x1;
    var y1 = o.y1;
    var x2 = o.x2;
    var y2 = o.y2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    var ang = Math.atan2(y2 - y1, x2 - x1);
    var len = Math.max(11, (o.width || 3) * 3.4);
    var spread = 0.46;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread));
    ctx.stroke();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawObject(ctx, o) {
    if (!o) return;
    var w = o.width || 3;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = o.color || "#1f2937";
    ctx.fillStyle = o.color || "#1f2937";
    ctx.lineWidth = w;
    if (o.type === "pen") {
      drawStroke(ctx, o.points, w);
    } else if (o.type === "highlighter") {
      ctx.globalAlpha = 0.32;
      drawStroke(ctx, o.points, Math.max(4, w * 3));
    } else if (o.type === "eraser") {
      // 橡皮在独立内容层上擦出透明洞，纸底/网格由底图保留；不是整笔删除。
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
      drawStroke(ctx, o.points, o.width || 26);
    } else if (o.type === "line") {
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
    } else if (o.type === "arrow") {
      drawArrow(ctx, o);
    } else if (o.type === "rect") {
      var r = normRect(o);
      if (o.fill) {
        ctx.globalAlpha = 0.16;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else if (o.type === "ellipse") {
      var b = normRect(o);
      var cx = b.x + b.w / 2;
      var cy = b.y + b.h / 2;
      var rx = Math.max(0.5, b.w / 2);
      var ry = Math.max(0.5, b.h / 2);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      if (o.fill) {
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
    } else if (o.type === "panel") {
      var darkPanel = theme().dark;
      ctx.save();
      ctx.fillStyle = darkPanel ? "rgba(38, 49, 43, 0.94)" : "rgba(255, 252, 244, 0.94)";
      ctx.strokeStyle = darkPanel ? "rgba(233, 220, 184, 0.34)" : "rgba(48, 92, 56, 0.3)";
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, o.x, o.y, o.w, o.h, 16);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = darkPanel ? "rgba(233, 220, 184, 0.2)" : "rgba(48, 92, 56, 0.16)";
      ctx.beginPath();
      ctx.moveTo(o.x + 14, o.y + 44);
      ctx.lineTo(o.x + o.w - 14, o.y + 44);
      ctx.stroke();
      ctx.fillStyle = darkPanel ? "#e7d6a9" : "#305c38";
      ctx.font = "600 15px " + FONT_STACK;
      ctx.textBaseline = "top";
      ctx.fillText(o.title || "板块", o.x + 18, o.y + 15);
      ctx.restore();
    } else if (o.type === "text") {
      var fs = o.fontSize || 28;
      var boxW = o.w || textWrapWidth();
      var boxH = o.h || fs * 1.4 + TEXT_PAD * 2;
      if (!o.lines || !o.lines.length) {
        o.lines = wrapLines(o.text, fs, textInnerWidth(boxW));
      }
      var lines = o.lines;
      var lh = fs * 1.4;
      ctx.save();
      ctx.beginPath();
      ctx.rect(o.x, o.y, boxW, boxH);
      ctx.clip();
      ctx.font = fs + "px " + FONT_STACK;
      ctx.textBaseline = "top";
      ctx.fillStyle = o.color || "#1f2937";
      for (var ti = 0; ti < lines.length; ti++) {
        ctx.fillText(lines[ti], o.x + TEXT_PAD, o.y + TEXT_PAD + ti * lh);
      }
      ctx.restore();
    } else if (o.type === "image") {
      var rec = getImage(o.src);
      if (rec && rec.ready && rec.img && rec.img.naturalWidth) {
        ctx.drawImage(rec.img, o.x, o.y, o.w, o.h);
      } else {
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = "#305c38";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#305c38";
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h);
        ctx.moveTo(o.x + o.w, o.y);
        ctx.lineTo(o.x, o.y + o.h);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawLive() {
    if (!page || !view.w) return;
    lctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    lctx.clearRect(0, 0, view.w, view.h);

    if (draft) {
      lctx.save();
      applyCamera(lctx);
      drawObject(lctx, draft);
      lctx.restore();
    }

    if (action && action.kind === "lasso" && action.points.length > 1) {
      drawLassoTrail(action.points);
    }

    if (selectedId) drawSelection();

    if (lassoIds.length) drawLassoSelection();

    if (laser.points.length) drawLaser();

    if (hoverPoint && tool === "eraser") {
      var radius = eraserRadius() * page.cam.scale;
      lctx.save();
      lctx.setLineDash([6, 4]);
      lctx.beginPath();
      lctx.arc(hoverPoint.x, hoverPoint.y, radius, 0, TAU);
      // 深色描边垫底，浅色背景也看得清
      lctx.strokeStyle = "rgba(28, 22, 8, 0.5)";
      lctx.lineWidth = 4;
      lctx.stroke();
      lctx.beginPath();
      lctx.arc(hoverPoint.x, hoverPoint.y, radius, 0, TAU);
      // 深色 / 浅色背景上都醒目的黄色虚线
      lctx.strokeStyle = "#ffc400";
      lctx.lineWidth = 2;
      lctx.stroke();
      lctx.restore();
    }
  }

  function drawSelection() {
    var o = findObject(selectedId);
    if (!o) {
      selectedId = null;
      return;
    }
    var b = selectionBounds(o);
    var c = page.cam;
    if (
      o.type === "line" ||
      o.type === "arrow" ||
      o.type === "pen" ||
      o.type === "highlighter" ||
      o.type === "rect" ||
      o.type === "ellipse" ||
      o.type === "panel"
    ) {
      // 激活的线条 / 形状只显示端点或角点小圆点；不再画虚线外框
      var r = Math.min(6.5, Math.max(4.5, handleSize() / 2));
      var dots = [];
      if (o.type === "line" || o.type === "arrow") {
        dots = [
          { x: o.x1 * c.scale + c.x, y: o.y1 * c.scale + c.y },
          { x: o.x2 * c.scale + c.x, y: o.y2 * c.scale + c.y }
        ];
      } else if (o.type === "pen" || o.type === "highlighter") {
        var pts = o.points || [];
        if (pts.length) {
          dots.push({ x: pts[0].x * c.scale + c.x, y: pts[0].y * c.scale + c.y });
          var lp = pts[pts.length - 1];
          dots.push({ x: lp.x * c.scale + c.x, y: lp.y * c.scale + c.y });
        }
      } else if (o.type === "panel") {
        dots = [
          { x: o.x * c.scale + c.x, y: o.y * c.scale + c.y },
          { x: (o.x + o.w) * c.scale + c.x, y: o.y * c.scale + c.y },
          { x: o.x * c.scale + c.x, y: (o.y + o.h) * c.scale + c.y },
          { x: (o.x + o.w) * c.scale + c.x, y: (o.y + o.h) * c.scale + c.y }
        ];
      } else {
        var rr = normRect(o);
        dots = [
          { x: rr.x * c.scale + c.x, y: rr.y * c.scale + c.y },
          { x: (rr.x + rr.w) * c.scale + c.x, y: rr.y * c.scale + c.y },
          { x: rr.x * c.scale + c.x, y: (rr.y + rr.h) * c.scale + c.y },
          { x: (rr.x + rr.w) * c.scale + c.x, y: (rr.y + rr.h) * c.scale + c.y }
        ];
      }
      lctx.save();
      lctx.fillStyle = "#fbf6e9";
      lctx.strokeStyle = "rgba(48,92,56,.95)";
      lctx.lineWidth = 1.6;
      dots.forEach(function (p) {
        lctx.beginPath();
        lctx.arc(p.x, p.y, r, 0, TAU);
        lctx.fill();
        lctx.stroke();
      });
      lctx.restore();
      return;
    }
    var pad = 5 / c.scale;
    var x = (b.x - pad) * c.scale + c.x;
    var y = (b.y - pad) * c.scale + c.y;
    var w = (b.w + pad * 2) * c.scale;
    var h = (b.h + pad * 2) * c.scale;
    lctx.save();
    lctx.strokeStyle = "rgba(48,92,56,.92)";
    lctx.fillStyle = "rgba(48,92,56,.06)";
    lctx.lineWidth = 1.4;
    lctx.setLineDash([5, 4]);
    lctx.fillRect(x, y, w, h);
    lctx.strokeRect(x, y, w, h);
    lctx.setLineDash([]);
    if (o.type === "image") {
      var ib = objectBounds(o);
      var ix = (ib.x - pad) * c.scale + c.x;
      var iy = (ib.y - pad) * c.scale + c.y;
      var iw = (ib.w + pad * 2) * c.scale;
      var ih = (ib.h + pad * 2) * c.scale;
      var hs = 10;
      var hx = ix + iw - hs / 2;
      var hy = iy + ih - hs / 2;
      lctx.fillStyle = "#fbf6e9";
      lctx.strokeStyle = "rgba(48,92,56,.95)";
      lctx.lineWidth = 1.4;
      lctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      lctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    } else if (o.type === "text") {
      var handles = textHandleRects(o);
      lctx.fillStyle = "#fbf6e9";
      lctx.strokeStyle = "rgba(48,92,56,.95)";
      lctx.lineWidth = 1.2;
      for (var hi = 0; hi < handles.length; hi++) {
        var hr = handles[hi];
        lctx.fillRect(hr.x, hr.y, hr.w, hr.h);
        lctx.strokeRect(hr.x, hr.y, hr.w, hr.h);
      }
    }
    lctx.restore();
  }

  function lassoAccent() {
    return theme().dark ? "#7cc4ff" : "#2f7fd0";
  }

  /* 正在拖的套索线：闭合后淡填充，虚线描边，宽度按屏幕像素恒定 */
  function drawLassoTrail(points) {
    if (!points || points.length < 2) return;
    var c = page.cam;
    var accent = lassoAccent();
    lctx.save();
    applyCamera(lctx);
    lctx.beginPath();
    lctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
      lctx.lineTo(points[i].x, points[i].y);
    }
    lctx.closePath();
    lctx.fillStyle = theme().dark ? "rgba(124,196,255,.1)" : "rgba(47,127,208,.08)";
    lctx.fill();
    lctx.strokeStyle = accent;
    lctx.lineWidth = 1.7 / c.scale;
    lctx.setLineDash([7 / c.scale, 5 / c.scale]);
    lctx.lineJoin = "round";
    lctx.stroke();
    lctx.restore();
  }

  /* 圈选后的多选状态：把每一笔淡淡描亮，再画一个虚线包围盒和四角小点 */
  function drawLassoSelection() {
    var list = lassoObjects();
    if (!list.length) return;
    var b = groupBounds(list);
    var c = page.cam;
    var accent = lassoAccent();
    lctx.save();

    lctx.save();
    applyCamera(lctx);
    lctx.globalAlpha = 0.34;
    lctx.strokeStyle = accent;
    lctx.fillStyle = accent;
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    for (var i = 0; i < list.length; i++) {
      drawLassoHighlight(lctx, list[i]);
    }
    lctx.restore();

    var pad = 6 / c.scale;
    var x = (b.x - pad) * c.scale + c.x;
    var y = (b.y - pad) * c.scale + c.y;
    var w = (b.w + pad * 2) * c.scale;
    var h = (b.h + pad * 2) * c.scale;
    lctx.fillStyle = theme().dark ? "rgba(124,196,255,.07)" : "rgba(47,127,208,.06)";
    lctx.strokeStyle = accent;
    lctx.lineWidth = 1.5;
    lctx.setLineDash([6, 4]);
    lctx.fillRect(x, y, w, h);
    lctx.strokeRect(x, y, w, h);
    lctx.setLineDash([]);
    lctx.fillStyle = "#fbf6e9";
    lctx.strokeStyle = accent;
    lctx.lineWidth = 1.4;
    var dots = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h]
    ];
    for (var d = 0; d < dots.length; d++) {
      lctx.beginPath();
      lctx.arc(dots[d][0], dots[d][1], 3.2, 0, TAU);
      lctx.fill();
      lctx.stroke();
    }
    lctx.restore();
  }

  function drawLassoHighlight(ctx, o) {
    var w = (o.width || 3) + 4;
    if (o.type === "pen") {
      drawStroke(ctx, o.points, w);
    } else if (o.type === "highlighter") {
      drawStroke(ctx, o.points, Math.max(8, w + 6));
    } else if (o.type === "line") {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
    } else if (o.type === "arrow") {
      ctx.lineWidth = w;
      drawArrow(ctx, o);
    } else if (o.type === "rect") {
      var r = normRect(o);
      ctx.lineWidth = w;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else if (o.type === "ellipse") {
      var b = normRect(o);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.ellipse(
        b.x + b.w / 2,
        b.y + b.h / 2,
        Math.max(0.5, b.w / 2),
        Math.max(0.5, b.h / 2),
        0,
        0,
        TAU
      );
      ctx.stroke();
    } else {
      var pb = objectBounds(o);
      ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
    }
  }

  function drawLaser() {
    var now = performance.now();
    var pts = laser.points;
    lctx.save();
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    lctx.shadowColor = "rgba(255, 64, 54, 0.85)";
    lctx.shadowBlur = 12;
    for (var i = 1; i < pts.length; i++) {
      var age = now - pts[i].at;
      var a = clamp(1 - age / 760, 0, 1);
      if (a <= 0.02) continue;
      lctx.strokeStyle = "rgba(255, 64, 54, " + (a * 0.85).toFixed(3) + ")";
      lctx.lineWidth = 4;
      lctx.beginPath();
      lctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      lctx.lineTo(pts[i].x, pts[i].y);
      lctx.stroke();
    }
    if (pts.length) {
      var last = pts[pts.length - 1];
      var aa = clamp(1 - (now - last.at) / 760, 0, 1);
      lctx.fillStyle = "rgba(255, 64, 54, " + (aa * 0.95).toFixed(3) + ")";
      lctx.beginPath();
      lctx.arc(last.x, last.y, 6, 0, TAU);
      lctx.fill();
      lctx.fillStyle = "rgba(255, 210, 200, " + (aa * 0.9).toFixed(3) + ")";
      lctx.beginPath();
      lctx.arc(last.x, last.y, 2.6, 0, TAU);
      lctx.fill();
    }
    lctx.restore();
  }

  function laserTick() {
    var now = performance.now();
    for (var i = laser.points.length - 1; i >= 0; i--) {
      if (now - laser.points[i].at > 780) laser.points.splice(i, 1);
    }
    drawLive();
    if (laser.points.length && isOpen) {
      laser.raf = window.requestAnimationFrame(laserTick);
    } else {
      laser.raf = 0;
    }
  }

  function startLaser() {
    laser.points = [];
    if (!laser.raf) laser.raf = window.requestAnimationFrame(laserTick);
  }

  function addLaserPoint(sp) {
    laser.points.push({ x: sp.x, y: sp.y, at: performance.now() });
    if (laser.points.length > 160) laser.points.shift();
    if (!laser.raf) laser.raf = window.requestAnimationFrame(laserTick);
    else drawLive();
  }

  /* ------------------------------ 几何判定 ------------------------------ */

  function objectBounds(o) {
    var w = o.width || 3;
    if (o.type === "pen" || o.type === "highlighter" || o.type === "eraser") {
      var pts = o.points || [];
      if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        minX = Math.min(minX, pts[i].x);
        minY = Math.min(minY, pts[i].y);
        maxX = Math.max(maxX, pts[i].x);
        maxY = Math.max(maxY, pts[i].y);
      }
      var pad = (o.type === "highlighter" ? w * 1.6 : w / 2) + 1;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    if (o.type === "line" || o.type === "arrow") {
      var pad2 = Math.max(2, w / 2);
      var x1 = Math.min(o.x1, o.x2) - pad2;
      var y1 = Math.min(o.y1, o.y2) - pad2;
      return {
        x: x1,
        y: y1,
        w: Math.abs(o.x2 - o.x1) + pad2 * 2,
        h: Math.abs(o.y2 - o.y1) + pad2 * 2
      };
    }
    if (o.type === "rect" || o.type === "ellipse") {
      var r = normRect(o);
      var pad3 = Math.max(1, w / 2);
      return {
        x: r.x - pad3,
        y: r.y - pad3,
        w: r.w + pad3 * 2,
        h: r.h + pad3 * 2
      };
    }
    if (o.type === "text") {
      return { x: o.x, y: o.y, w: Math.max(8, o.w || 0), h: Math.max(8, o.h || 0) };
    }
    if (o.type === "panel") {
      return { x: o.x, y: o.y, w: Math.max(1, o.w || 0), h: Math.max(1, o.h || 0) };
    }
    if (o.type === "image") {
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function insideRect(b, x, y, pad) {
    pad = pad || 0;
    return (
      x >= b.x - pad &&
      x <= b.x + b.w + pad &&
      y >= b.y - pad &&
      y <= b.y + b.h + pad
    );
  }

  /* 圈选：点在多边形内（射线法）。套索本身是自由曲线，按闭合折线处理。 */
  function pointInPolygon(poly, x, y) {
    if (!poly || poly.length < 3) return false;
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x;
      var yi = poly[i].y;
      var xj = poly[j].x;
      var yj = poly[j].y;
      if ((yi > y) !== (yj > y)) {
        var xr = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (x < xr) inside = !inside;
      }
    }
    return inside;
  }

  /* 判断两线段是否相交（含端点 / 共线贴合）。圈选时只要笔迹和圈有一点接触就算。 */
  function onSegment(ax, ay, bx, by, px, py) {
    return (
      px >= Math.min(ax, bx) - 1e-6 &&
      px <= Math.max(ax, bx) + 1e-6 &&
      py >= Math.min(ay, by) - 1e-6 &&
      py <= Math.max(ay, by) + 1e-6
    );
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var EPS = 1e-6;
    var o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    var o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    var o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    var o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    if (
      ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) &&
      ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))
    ) {
      return true;
    }
    if (Math.abs(o1) <= EPS && onSegment(ax, ay, bx, by, cx, cy)) return true;
    if (Math.abs(o2) <= EPS && onSegment(ax, ay, bx, by, dx, dy)) return true;
    if (Math.abs(o3) <= EPS && onSegment(cx, cy, dx, dy, ax, ay)) return true;
    if (Math.abs(o4) <= EPS && onSegment(cx, cy, dx, dy, bx, by)) return true;
    return false;
  }

  /* 一条线段和套索圈是否有任何接触 */
  function polygonSegmentHit(poly, x1, y1, x2, y2) {
    if (pointInPolygon(poly, x1, y1) || pointInPolygon(poly, x2, y2)) {
      return true;
    }
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (
        segmentsIntersect(
          x1,
          y1,
          x2,
          y2,
          poly[j].x,
          poly[j].y,
          poly[i].x,
          poly[i].y
        )
      ) {
        return true;
      }
    }
    return false;
  }

  /* 笔迹任意一段和套索接触，整笔就算圈中 */
  function strokeLassoHit(poly, pts) {
    if (!pts || !pts.length) return false;
    if (pts.length === 1) return pointInPolygon(poly, pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      if (
        polygonSegmentHit(
          poly,
          pts[i - 1].x,
          pts[i - 1].y,
          pts[i].x,
          pts[i].y
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function rectPolygon(b) {
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h }
    ];
  }

  function ellipsePolygon(b) {
    var pts = [];
    var cx = b.x + b.w / 2;
    var cy = b.y + b.h / 2;
    var rx = Math.max(0.5, b.w / 2);
    var ry = Math.max(0.5, b.h / 2);
    var n = 64;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return pts;
  }

  function polygonOverlap(a, b) {
    var i;
    for (i = 0; i < a.length; i++) {
      if (pointInPolygon(b, a[i].x, a[i].y)) return true;
    }
    for (i = 0; i < b.length; i++) {
      if (pointInPolygon(a, b[i].x, b[i].y)) return true;
    }
    for (i = 0; i < a.length; i++) {
      var ai = a[i];
      var aj = a[(i + 1) % a.length];
      for (var j = 0; j < b.length; j++) {
        var bj = b[j];
        var bk = b[(j + 1) % b.length];
        if (segmentsIntersect(ai.x, ai.y, aj.x, aj.y, bj.x, bj.y, bk.x, bk.y)) {
          return true;
        }
      }
    }
    return false;
  }

  /* 套索圈和对象实际图形有没有接触：圈里只要压到一小段，整笔都算 */
  function objectLassoHit(poly, o) {
    if (o.type === "pen" || o.type === "highlighter") {
      return strokeLassoHit(poly, o.points || []);
    }
    if (o.type === "line" || o.type === "arrow") {
      return polygonSegmentHit(poly, o.x1, o.y1, o.x2, o.y2);
    }
    if (o.type === "rect") {
      return polygonOverlap(poly, rectPolygon(normRect(o)));
    }
    if (o.type === "ellipse") {
      return polygonOverlap(poly, ellipsePolygon(normRect(o)));
    }
    return polygonOverlap(poly, rectPolygon(objectBounds(o)));
  }

  function lassoHitIds(poly) {
    if (!page) return [];
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var p = 0; p < poly.length; p++) {
      minX = Math.min(minX, poly[p].x);
      minY = Math.min(minY, poly[p].y);
      maxX = Math.max(maxX, poly[p].x);
      maxY = Math.max(maxY, poly[p].y);
    }
    var ids = [];
    for (var i = 0; i < page.objects.length; i++) {
      var o = page.objects[i];
      if (o.type === "eraser") continue;
      var b = objectBounds(o);
      // 先按包围盒排除完全在圈外的对象，再按实际形状判断是否接触
      if (
        b.x > maxX ||
        b.x + b.w < minX ||
        b.y > maxY ||
        b.y + b.h < minY
      ) {
        continue;
      }
      if (objectLassoHit(poly, o)) ids.push(o.id);
    }
    return ids;
  }

  function lassoObjects() {
    if (!page || !lassoIds.length) return [];
    var want = {};
    for (var i = 0; i < lassoIds.length; i++) want[lassoIds[i]] = 1;
    var out = [];
    for (var j = 0; j < page.objects.length; j++) {
      var o = page.objects[j];
      if (want[o.id] && o.type !== "eraser") out.push(o);
    }
    if (out.length !== lassoIds.length) {
      lassoIds = out.map(function (o) {
        return o.id;
      });
    }
    return out;
  }

  function clearLasso(redraw) {
    if (!lassoIds.length) return;
    lassoIds = [];
    if (redraw) drawLive();
  }

  /* 当前选中的对象：圈选返回整组，普通选择返回图片组 / 单个对象。 */
  function selectedObjectList() {
    if (lassoIds.length) return lassoObjects();
    var root = findObject(selectedId);
    return root ? groupObjects(root) : [];
  }

  /* 判断点击是否落在圈选组里：点中任意一笔，或点在这组包围盒内，都算。 */
  function lassoPointHit(x, y) {
    var list = lassoObjects();
    if (!list.length) return false;
    var tol = 5 / page.cam.scale;
    if (insideRect(groupBounds(list), x, y, tol)) return true;
    for (var i = 0; i < list.length; i++) {
      if (nearObject(list[i], x, y, tol)) return true;
    }
    return false;
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(px - x1, py - y1);
    var t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function distToStroke(pts, x, y) {
    if (!pts || !pts.length) return Infinity;
    if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y);
    var best = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var d = distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (d < best) best = d;
    }
    return best;
  }

  function nearObject(o, x, y, tol) {
    tol = tol || 0;
    var w = o.width || 3;
    if (o.type === "pen") {
      return distToStroke(o.points, x, y) <= w / 2 + tol;
    }
    if (o.type === "highlighter") {
      return distToStroke(o.points, x, y) <= w * 1.5 + tol;
    }
    if (o.type === "line" || o.type === "arrow") {
      return distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= Math.max(8, w / 2) + tol;
    }
    if (o.type === "rect") {
      var r = normRect(o);
      var inside =
        x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
      if (inside) {
        if (o.fill) return true;
        var edge = Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
        return edge <= tol + w / 2;
      }
      var dx = Math.max(r.x - x, 0, x - (r.x + r.w));
      var dy = Math.max(r.y - y, 0, y - (r.y + r.h));
      return Math.hypot(dx, dy) <= tol + w / 2;
    }
    if (o.type === "ellipse") {
      var b = normRect(o);
      var rx = Math.max(1, b.w / 2);
      var ry = Math.max(1, b.h / 2);
      var cx = b.x + rx;
      var cy = b.y + ry;
      var nd = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (o.fill && nd <= 1) return true;
      return Math.abs(nd - 1) * Math.min(rx, ry) <= tol + w / 2;
    }
    return insideRect(objectBounds(o), x, y, tol);
  }

  function hitTest(x, y, precise, raw) {
    if (!page) return null;
    var tol = (precise ? 2 : 0) / page.cam.scale;
    for (var i = page.objects.length - 1; i >= 0; i--) {
      var o = page.objects[i];
      if (o.type === "eraser") continue;
      var hit = false;
      if (precise) {
        hit = nearObject(o, x, y, tol);
      } else {
        hit = insideRect(objectBounds(o), x, y, 5 / page.cam.scale);
      }
      if (!hit) continue;
      return o;
    }
    return null;
  }

  function eraserRadius() {
    return 8 + width * 1.4;
  }

  function handleSize() {
    try {
      return window.matchMedia("(pointer: coarse)").matches ? 14 : 9;
    } catch (err) {
      return 9;
    }
  }

  function textHandleRects(o) {
    var b = objectBounds(o);
    var c = page.cam;
    var pad = 5 / c.scale;
    var x = (b.x - pad) * c.scale + c.x;
    var y = (b.y - pad) * c.scale + c.y;
    var w = (b.w + pad * 2) * c.scale;
    var h = (b.h + pad * 2) * c.scale;
    var s = handleSize();
    var half = s / 2;
    var out = [];
    function add(dir, px, py) {
      out.push({ dir: dir, x: px - half, y: py - half, w: s, h: s });
    }
    add("nw", x, y);
    add("n", x + w / 2, y);
    add("ne", x + w, y);
    add("e", x + w, y + h / 2);
    add("se", x + w, y + h);
    add("s", x + w / 2, y + h);
    add("sw", x, y + h);
    add("w", x, y + h / 2);
    return out;
  }

  function textHandleAt(o, sp) {
    var rects = textHandleRects(o);
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (
        sp.x >= r.x - 3 &&
        sp.x <= r.x + r.w + 3 &&
        sp.y >= r.y - 3 &&
        sp.y <= r.y + r.h + 3
      ) {
        return r.dir;
      }
    }
    return "";
  }

  function panelHandleAt(o, sp) {
    if (!o || o.type !== "panel" || !page) return "";
    var c = page.cam;
    var r = handleSize() / 2 + 4;
    var pts = [
      { dir: "nw", x: o.x * c.scale + c.x, y: o.y * c.scale + c.y },
      { dir: "ne", x: (o.x + o.w) * c.scale + c.x, y: o.y * c.scale + c.y },
      { dir: "sw", x: o.x * c.scale + c.x, y: (o.y + o.h) * c.scale + c.y },
      { dir: "se", x: (o.x + o.w) * c.scale + c.x, y: (o.y + o.h) * c.scale + c.y }
    ];
    for (var i = 0; i < pts.length; i++) {
      if (Math.abs(sp.x - pts[i].x) <= r && Math.abs(sp.y - pts[i].y) <= r) {
        return pts[i].dir;
      }
    }
    return "";
  }

  function lineHandleAt(o, sp) {
    if (!o || (o.type !== "line" && o.type !== "arrow") || !page) return 0;
    var c = page.cam;
    var r = handleSize() / 2 + 5;
    var a = { x: o.x1 * c.scale + c.x, y: o.y1 * c.scale + c.y };
    var b = { x: o.x2 * c.scale + c.x, y: o.y2 * c.scale + c.y };
    if (Math.hypot(sp.x - a.x, sp.y - a.y) <= r) return 1;
    if (Math.hypot(sp.x - b.x, sp.y - b.y) <= r) return 2;
    return 0;
  }

  function imageHandleHit(o, sp) {
    var b = objectBounds(o);
    var c = page.cam;
    var hx = (b.x + b.w) * c.scale + c.x;
    var hy = (b.y + b.h) * c.scale + c.y;
    return Math.abs(sp.x - hx) <= 10 && Math.abs(sp.y - hy) <= 10;
  }

  function translateObject(o, dx, dy) {
    var c = cloneObject(o);
    if (c.points) {
      c.points = c.points.map(function (p) {
        return { x: p.x + dx, y: p.y + dy };
      });
    }
    if (typeof c.x === "number") c.x += dx;
    if (typeof c.y === "number") c.y += dy;
    if (typeof c.x1 === "number") {
      c.x1 += dx;
      c.y1 += dy;
      c.x2 += dx;
      c.y2 += dy;
    }
    return c;
  }

  function scaleObjectAbout(o, ox, oy, sx, sy) {
    var c = cloneObject(o);
    if (c.points) {
      c.points = c.points.map(function (p) {
        return {
          x: round2(ox + (p.x - ox) * sx),
          y: round2(oy + (p.y - oy) * sy)
        };
      });
    }
    if (typeof c.x === "number") c.x = ox + (c.x - ox) * sx;
    if (typeof c.y === "number") c.y = oy + (c.y - oy) * sy;
    if (c.type === "text") {
      c.w = Math.max(40, (c.w || 80) * sx);
      c.h = Math.max(30, (c.h || 60) * sy);
      c.fontSize = clamp((c.fontSize || 28) * Math.min(sx, sy), 10, 160);
      c.manual = true;
      c.lines = [];
      relayoutTextBox(c);
    } else if (c.type === "image") {
      c.w = Math.max(20, (c.w || 20) * sx);
      c.h = Math.max(20, (c.h || 20) * sy);
    }
    if (typeof c.x1 === "number") {
      c.x1 = ox + (c.x1 - ox) * sx;
      c.y1 = oy + (c.y1 - oy) * sy;
      c.x2 = ox + (c.x2 - ox) * sx;
      c.y2 = oy + (c.y2 - oy) * sy;
    }
    if (
      typeof c.width === "number" &&
      c.type !== "image" &&
      c.type !== "text"
    ) {
      c.width = clamp(c.width * ((sx + sy) / 2), 1, 160);
    }
    return c;
  }

  function imageAt(x, y) {
    if (!page) return null;
    for (var i = page.objects.length - 1; i >= 0; i--) {
      var o = page.objects[i];
      if (o.type !== "image") continue;
      if (insideRect(objectBounds(o), x, y, 0)) return o;
    }
    return null;
  }

  function groupRoot(o) {
    if (!o) return null;
    if (!o.parentId) return o;
    var parent = findObject(o.parentId);
    return parent && parent.type === "image" ? parent : o;
  }

  function groupObjects(root) {
    if (!root) return [];
    if (root.type !== "image") return [root];
    var list = [root];
    for (var i = 0; i < page.objects.length; i++) {
      if (page.objects[i].parentId === root.id) list.push(page.objects[i]);
    }
    return list;
  }

  function groupBounds(list) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var b = objectBounds(list[i]);
      if (!isFinite(b.x) || !isFinite(b.y)) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function selectionBounds(o) {
    if (!o) return { x: 0, y: 0, w: 0, h: 0 };
    if (o.type === "image") return groupBounds(groupObjects(o));
    return objectBounds(o);
  }

  /* ------------------------------ 历史记录 ------------------------------ */

  function history() {
    if (!page) return { undo: [], redo: [] };
    if (!histories[page.id]) histories[page.id] = { undo: [], redo: [] };
    return histories[page.id];
  }

  function snapshot() {
    return {
      objects: page ? page.objects.slice() : [],
      bg: page ? page.bg : "white"
    };
  }

  function restoreSnapshot(s) {
    if (!page || !s) return;
    page.objects = s.objects || [];
    page.bg = s.bg || "white";
    selectedId = null;
    clearLasso(false);
    renderChrome();
    drawAll();
    drawLive();
  }

  function pushHistory() {
    var h = history();
    h.undo.push(snapshot());
    if (h.undo.length > MAX_HISTORY) h.undo.shift();
    h.redo.length = 0;
    syncHistoryUi();
  }

  function undo() {
    commitText();
    var h = history();
    if (!h.undo.length) return;
    hideToast();
    h.redo.push(snapshot());
    restoreSnapshot(h.undo.pop());
    syncHistoryUi();
    markDirty();
  }

  function redo() {
    commitText();
    var h = history();
    if (!h.redo.length) return;
    hideToast();
    h.undo.push(snapshot());
    restoreSnapshot(h.redo.pop());
    syncHistoryUi();
    markDirty();
  }

  function syncHistoryUi() {
    var h = history();
    if (el.undo) el.undo.disabled = !h.undo.length;
    if (el.redo) el.redo.disabled = !h.redo.length;
  }

  /* --------------------------- 读写 localStorage --------------------------- */

  function newPage(name, bg, width) {
    return {
      id: uid(),
      name: name,
      bg: bg || "white",
      width: width > 0 ? width : 0,
      objects: [],
      cam: { x: 0, y: 0, scale: 1 }
    };
  }

  function sanitizeObject(o) {
    if (!o || typeof o !== "object") return null;
    var type = o.type;
    if (
      [
        "pen",
        "highlighter",
        "eraser",
        "line",
        "arrow",
        "rect",
        "ellipse",
        "text",
        "image",
        "panel"
      ].indexOf(type) === -1
    ) {
      return null;
    }
    var c = { id: typeof o.id === "string" && o.id ? o.id : uid(), type: type };
    if (typeof o.parentId === "string" && o.parentId) c.parentId = o.parentId;
    c.color =
      typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color)
        ? o.color
        : "#1f2937";
    c.width = clamp(Number(o.width) || 3, 1, 160);
    if (type === "pen" || type === "highlighter" || type === "eraser") {
      if (!Array.isArray(o.points)) return null;
      var pts = [];
      for (var i = 0; i < o.points.length; i++) {
        var p = o.points[i];
        if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) continue;
        pts.push({ x: round2(Number(p.x)), y: round2(Number(p.y)) });
      }
      if (!pts.length) return null;
      c.points = pts;
      if (type === "eraser") {
        c.color = "#000000";
        c.width = clamp(Number(o.width) || 26, 4, 160);
      }
    } else if (type === "line" || type === "arrow" || type === "rect" || type === "ellipse") {
      var nums = ["x1", "y1", "x2", "y2"];
      for (var j = 0; j < nums.length; j++) {
        if (!isFinite(Number(o[nums[j]]))) return null;
        c[nums[j]] = round2(Number(o[nums[j]]));
      }
      c.fill = !!o.fill;
    } else if (type === "text") {
      if (typeof o.text !== "string" || !o.text) return null;
      if (o.text.length > 6000) o = Object.assign({}, o, { text: o.text.slice(0, 6000) });
      c.text = o.text;
      c.fontSize = clamp(Number(o.fontSize) || 28, 10, 160);
      c.x = round2(Number(o.x) || 0);
      c.y = round2(Number(o.y) || 0);
      c.w = clamp(Number(o.w) || 0, 0, 6000);
      c.h = clamp(Number(o.h) || 0, 0, 20000);
      c.manual = !!o.manual;
      c.lines = [];
    } else if (type === "image") {
      if (typeof o.src !== "string" || o.src.indexOf("data:image/") !== 0) return null;
      if (o.src.length > 6000000) return null;
      c.src = o.src;
      c.x = round2(Number(o.x) || 0);
      c.y = round2(Number(o.y) || 0);
      c.w = clamp(Number(o.w) || 320, 10, 20000);
      c.h = clamp(Number(o.h) || 240, 10, 20000);
    } else if (type === "panel") {
      c.x = round2(Number(o.x) || 0);
      c.y = round2(Number(o.y) || 0);
      c.w = clamp(Number(o.w) || 520, 120, 6000);
      c.h = clamp(Number(o.h) || 300, 100, 6000);
      c.title =
        typeof o.title === "string" && o.title
          ? o.title.slice(0, 32)
          : "板块";
    }
    return c;
  }

  function sanitizeCam(c) {
    if (!c || typeof c !== "object") return { x: 0, y: 0, scale: 1 };
    return {
      x: isFinite(Number(c.x)) ? Number(c.x) : 0,
      y: isFinite(Number(c.y)) ? Number(c.y) : 0,
      // 白板固定 100% 尺寸，不再提供其它缩放档位
      scale: 1
    };
  }

  /* 旧白板可能把内容画到 y<0 / x<0（以前可以无限四方向滚）。读取时把内容
     挪回上边界和左边界内，并同步相机，既不丢内容，也符合新的边界规则。 */
  function normalizePageTop(p) {
    var minX = Infinity;
    var minY = Infinity;
    for (var i = 0; i < p.objects.length; i++) {
      var b = objectBounds(p.objects[i]);
      if (isFinite(b.x)) minX = Math.min(minX, b.x);
      if (isFinite(b.y)) minY = Math.min(minY, b.y);
    }
    var dx = isFinite(minX) && minX < -0.5 ? -minX : 0;
    var dy = isFinite(minY) && minY < -0.5 ? -minY : 0;
    if (dx || dy) {
      var scale = p.cam.scale || 1;
      p.objects = p.objects.map(function (o) {
        return translateObject(o, dx, dy);
      });
      p.cam.x -= dx * scale;
      p.cam.y -= dy * scale;
    }
    if (!isFinite(p.cam.y) || p.cam.y > 0) p.cam.y = 0;
  }

  function sanitizeSettings(s) {
    s = s && typeof s === "object" ? s : {};
    var t = s.tool;
    var valid = false;
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === t) valid = true;
    }
    t = valid ? t : "pen";
    var textCustom = !!s.textSizeCustomized;
    var widths = {};
    Object.keys(DEFAULT_TOOL_WIDTHS).forEach(function (k) {
      var n = s.widths && s.widths[k];
      widths[k] = clamp(
        Number(n) || DEFAULT_TOOL_WIDTHS[k],
        1,
        40
      );
    });
    widths.text = textCustom
      ? clamp(isFinite(Number(s.widths && s.widths.text)) ? Number(s.widths.text) : 2, 0, 40)
      : 2;
    var rawWidth = Number(s.width);
    var baseWidth = isFinite(rawWidth)
      ? rawWidth
      : widths[t] != null
        ? widths[t]
        : 4;
    var width = clamp(baseWidth, t === "text" ? 0 : 1, 40);
    if (t === "text" && !textCustom) width = 2;
    if (widths[t] != null) widths[t] = width;
    return {
      tool: t,
      color:
        typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color)
          ? s.color
          : "#1f2937",
      width: width,
      widths: widths,
      textSizeCustomized: textCustom,
      fill: !!s.fill
    };
  }

  function normalizeDoc(raw) {
    if (!raw || !Array.isArray(raw.pages) || !raw.pages.length) return null;
    var pages = [];
    var migrated = false;
    for (var i = 0; i < raw.pages.length && pages.length < 60; i++) {
      var p = raw.pages[i];
      if (!p || typeof p !== "object") continue;
      var objects = [];
      if (Array.isArray(p.objects)) {
        for (var j = 0; j < p.objects.length && objects.length < 4000; j++) {
          var o = sanitizeObject(p.objects[j]);
          if (o) objects.push(o);
        }
      }
      var bg = "white";
      for (var k = 0; k < THEMES.length; k++) {
        if (THEMES[k].id === p.bg) bg = p.bg;
      }
      if (OLD_BG_MAP[bg]) {
        bg = OLD_BG_MAP[bg];
        migrated = true;
      }
      var oldName = String(p.name || "");
      if (!oldName || /^白板\s*\d*$/.test(oldName) || oldName === "教学白板") {
        oldName = timePageName(Number(raw.updatedAt) || Date.now());
        migrated = true;
      }
      var width = Number(p.width);
      pages.push({
        id: typeof p.id === "string" && p.id ? p.id : uid(),
        name: oldName.slice(0, 24),
        bg: bg,
        width: isFinite(width) && width > 0 ? clamp(width, 240, 6000) : 0,
        objects: objects,
        cam: sanitizeCam(p.cam)
      });
    }
    if (!pages.length) return null;

    // 旧数据可能有多页；新白板不再分页，这里把各页内容按顺序接到下面，合成一块。
    if (pages.length > 1) {
      migrated = true;
      var base = pages[0];
      var merged = base.objects.slice();
      var baseBox = pageContentBounds(base);
      var cursor = baseBox ? baseBox.y + baseBox.h + 80 : 0;
      var maxWidth = base.width || 0;
      for (var m = 1; m < pages.length; m++) {
        var pg = pages[m];
        maxWidth = Math.max(maxWidth, pg.width || 0);
        var box = pageContentBounds(pg);
        if (!box) continue;
        var dy = cursor - box.y;
        var idMap = {};
        var movedList = [];
        for (var q = 0; q < pg.objects.length; q++) {
          var moved = translateObject(pg.objects[q], 0, dy);
          idMap[pg.objects[q].id] = moved.id = uid();
          movedList.push({ obj: moved, oldParent: pg.objects[q].parentId });
        }
        for (var r = 0; r < movedList.length; r++) {
          if (movedList[r].oldParent) {
            movedList[r].obj.parentId =
              idMap[movedList[r].oldParent] || movedList[r].oldParent;
          }
          merged.push(movedList[r].obj);
        }
        cursor += box.h + 80;
      }
      base.objects = merged;
      if (maxWidth) base.width = clamp(maxWidth, 240, 6000);
      pages = [base];
    }

    var single = pages[0];
    normalizePageTop(single);
    if (single.width > 0) rewrapPageText(single);

    return {
      v: 1,
      pages: pages,
      activeId: single.id,
      updatedAt: Number(raw.updatedAt) || Date.now(),
      settings: sanitizeSettings(raw.settings),
      _migrated: migrated
    };
  }

  function pageContentBounds(p) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < p.objects.length; i++) {
      var b = objectBounds(p.objects[i]);
      if (!isFinite(b.x) || !isFinite(b.y)) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function newDoc() {
    var p = newPage(timePageName(), "white");
    return {
      v: 1,
      pages: [p],
      activeId: p.id,
      updatedAt: 0,
      settings: {
        tool: "pen",
        color: "#1f2937",
        width: 4,
        widths: toolWidths,
        textSizeCustomized: false,
        fill: false
      }
    };
  }

  function loadDoc() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeDoc(JSON.parse(raw));
    } catch (err) {
      return null;
    }
  }

  function saveDoc() {
    if (!loaded || !doc || !page) return;
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      doc.activeId = page.id;
      doc.updatedAt = Date.now();
      doc.settings = {
        tool: tool,
        color: color,
        width: width,
        widths: toolWidths,
        textSizeCustomized: textSizeCustomized,
        fill: fillShape
      };
      var payload = {
        v: 1,
        updatedAt: doc.updatedAt,
        activeId: doc.activeId,
        pages: doc.pages,
        settings: doc.settings
      };
      var text = JSON.stringify(payload);
      window.localStorage.setItem(STORAGE_KEY, text);
      dirty = false;
      doc._migrated = false;
      setSaved("saved", "已保存 · " + formatClock(doc.updatedAt));
    } catch (err) {
      dirty = true;
      setSaved("error", "本地空间不足");
      if (Date.now() - quotaWarnAt > 45000) {
        quotaWarnAt = Date.now();
        showToast(
          "本地保存失败：浏览器空间不够。请先导出工程文件备份，再删掉一些图片。",
          "导出工程",
          exportJson,
          9000
        );
      }
    }
  }

  function markDirty() {
    if (!loaded || !page) return;
    dirty = true;
    setSaved("saving", "保存中…");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDoc, SAVE_DELAY);
  }

  function saveNow() {
    if (!loaded || !dirty) return;
    saveDoc();
  }

  /* ------------------------------- 文字 ------------------------------- */

  function textFontSize() {
    return 14 + width * 4;
  }

  function wrapLines(text, fontSize, maxWidth) {
    measureCtx.font = fontSize + "px " + FONT_STACK;
    var out = [];
    var parts = String(text).split("\n");
    for (var p = 0; p < parts.length; p++) {
      var par = parts[p];
      if (!par) {
        out.push("");
        continue;
      }
      var chars = Array.from ? Array.from(par) : par.split("");
      var line = "";
      for (var i = 0; i < chars.length; i++) {
        var test = line + chars[i];
        if (line && measureCtx.measureText(test).width > maxWidth) {
          out.push(line);
          line = chars[i];
        } else {
          line = test;
        }
      }
      out.push(line);
    }
    return out.length ? out : [""];
  }

  function measureLines(lines, fontSize) {
    measureCtx.font = fontSize + "px " + FONT_STACK;
    var max = 0;
    for (var i = 0; i < lines.length; i++) {
      max = Math.max(max, measureCtx.measureText(lines[i]).width);
    }
    return { contentW: max, contentH: lines.length * fontSize * 1.4 };
  }

  function textInnerWidth(outerWidth) {
    return Math.max(20, outerWidth - TEXT_PAD * 2);
  }

  function textLayout(obj, outerWidth) {
    var inner = textInnerWidth(outerWidth);
    var lines = wrapLines(obj.text, obj.fontSize, inner);
    var m = measureLines(lines, obj.fontSize);
    return { lines: lines, contentW: m.contentW, contentH: m.contentH };
  }

  function relayoutTextBox(obj) {
    if (!obj.w || obj.w < 40) obj.w = Math.max(80, textWrapWidth());
    var lay = textLayout(obj, obj.w);
    obj.lines = lay.lines;
    if (
      !obj.h ||
      obj.h < obj.fontSize * 1.4 + TEXT_PAD * 2
    ) {
      obj.h = Math.max(
        obj.fontSize * 1.4 + TEXT_PAD * 2,
        lay.contentH + TEXT_PAD * 2
      );
    }
  }

  /* 输入中的文字框：从一个小框开始，随字号和内容自动长宽；
     宽度到上限后折行，高度继续长。 */
  function fitEditingTextBox(obj) {
    // 只到白板右边界才换行；不再用 560px 的固定折行宽度
    var maxW = Math.max(80, boardWidth() - Math.max(0, obj.x));
    var minW = Math.max(48, obj.fontSize * 2.4 + TEXT_PAD * 2);
    var raw = String(obj.text || "");
    var rawLines = raw.split("\n");
    measureCtx.font = obj.fontSize + "px " + FONT_STACK;
    var contentW = 0;
    for (var i = 0; i < rawLines.length; i++) {
      contentW = Math.max(contentW, measureCtx.measureText(rawLines[i]).width);
    }
    var w = Math.min(maxW, Math.max(minW, Math.ceil(contentW) + TEXT_PAD * 2));
    var lines = wrapLines(raw, obj.fontSize, textInnerWidth(w));
    obj.w = w;
    obj.h = Math.max(
      obj.fontSize * 1.4 + TEXT_PAD * 2,
      lines.length * obj.fontSize * 1.4 + TEXT_PAD * 2
    );
    obj.lines = lines;
    if (obj.x + obj.w > boardWidth()) {
      obj.x = Math.max(0, boardWidth() - obj.w);
    }
  }

  function defaultTextWidthFor(boardW) {
    return Math.max(
      220,
      Math.min(520, textWrapWidthFor(boardW || boardWidth()))
    );
  }

  function defaultTextHeight(fontSize) {
    return Math.max(88, fontSize * 1.4 * 2 + TEXT_PAD * 2);
  }

  /* 文字框从创建时就固定大小，打字 / 提交不再自动撑宽或撑高；
     只有用户拖四边 / 四角时才改尺寸。 */
  function initTextBox(obj, boardW) {
    if (!obj.w || obj.w < 40) obj.w = defaultTextWidthFor(boardW);
    obj.h = Math.max(obj.h || 0, defaultTextHeight(obj.fontSize));
    obj.manual = true;
    relayoutTextBox(obj);
  }

  function applyTextStyle(noPan) {
    if (!textState || !page) return;
    var t = textState.obj;
    var s = page.cam.scale;
    var fs = Math.max(10, t.fontSize * s);
    var boxW = t.w || textWrapWidth();
    var boxH = t.h || 0;
    el.textEdit.style.left = (t.x * s + page.cam.x).toFixed(1) + "px";
    el.textEdit.style.top = (t.y * s + page.cam.y).toFixed(1) + "px";
    el.textEdit.style.width = Math.max(28, boxW * s).toFixed(1) + "px";
    el.textEdit.style.fontSize = fs + "px";
    el.textEdit.style.lineHeight = "1.4";
    el.textEdit.style.color = t.color;
    el.textEdit.style.caretColor = t.color;
    el.textEdit.style.background = "transparent";
    el.textEdit.style.boxShadow = "none";
    el.textEdit.style.borderStyle = t.text ? "solid" : "dashed";
    el.textEdit.style.borderColor = t.color;
    el.textEdit.style.height = Math.max(24, boxH * s).toFixed(1) + "px";
    el.textEdit.style.overflowY = "hidden";
    // 浏览器实际折行可能比测量略高，贴住 scrollHeight，保证最后一行不被裁掉
    var sh = el.textEdit.scrollHeight;
    var chh = el.textEdit.clientHeight;
    if (sh > chh + 1 && s > 0) {
      var needH = sh + 2;
      el.textEdit.style.height = needH + "px";
      t.h = Math.max(t.h || 0, needH / s);
    }
    // 输入变长时让画布跟着光标上移，光标不会掉到屏幕外
    if (!noPan && !textAutoPanning) {
      var top = parseFloat(el.textEdit.style.top) || 0;
      var bottom = top + el.textEdit.offsetHeight;
      var margin = 14;
      if (bottom > view.h - margin) {
        var maxUp = Math.max(0, top - margin);
        var shift = Math.min(bottom - (view.h - margin), maxUp);
        if (shift > 1) {
          textAutoPanning = true;
          page.cam.y -= shift;
          clampCamera();
          drawAll();
          drawLive();
          textAutoPanning = false;
          applyTextStyle(true);
        }
      }
    }
  }

  function positionText() {
    if (!textState) return;
    applyTextStyle();
  }

  function beginText(wx, wy, existing, parentId) {
    commitText();
    var fs = existing ? existing.fontSize : textFontSize();
    var col = existing ? existing.color : color;
    var obj = existing
      ? cloneObject(existing)
      : {
          id: uid(),
          type: "text",
          x: wx,
          y: wy,
          fontSize: fs,
          color: col,
          text: "",
          lines: [],
          w: 0,
          h: 0,
          manual: true,
          parentId: parentId || ""
        };
    var idx = existing ? objectIndex(existing.id) : -1;
    if (existing && idx >= 0) {
      // 编辑期间先把原文字从画布拿掉，避免旧文字从透明输入框后面透出来
      page.objects.splice(idx, 1);
    }
    obj.text = existing ? existing.text : "";
    obj.w = 0;
    obj.h = 0;
    fitEditingTextBox(obj);
    textState = {
      obj: obj,
      isNew: !existing || idx < 0,
      original: idx >= 0 ? existing : null,
      index: idx >= 0 ? idx : page.objects.length,
      removed: idx >= 0
    };
    selectedId = null;
    el.textEdit.hidden = false;
    el.textEdit.value = obj.text;
    positionText();
    el.textEdit.focus();
    var len = el.textEdit.value.length;
    try {
      el.textEdit.setSelectionRange(len, len);
    } catch (err) {}
    drawAll();
    drawLive();
  }

  function commitText() {
    if (!textState) return;
    var st = textState;
    var raw = el.textEdit.value.replace(/\r\n/g, "\n");
    textState = null;
    el.textEdit.hidden = true;
    el.textEdit.value = "";

    // 编辑时原对象被临时移出画布；提交 / 取消前先放回，历史快照才完整
    if (st.removed && st.original) {
      var at = clamp(st.index, 0, page.objects.length);
      page.objects.splice(at, 0, st.original);
      st.removed = false;
    }

    if (st.isNew) {
      if (!raw.trim()) {
        drawAll();
        drawLive();
        return;
      }
      var obj = cloneObject(st.obj);
      obj.text = raw;
      obj.manual = true;
      var keepH = obj.h || 0;
      fitEditingTextBox(obj);
      obj.h = Math.max(obj.h, keepH);
      pushHistory();
      page.objects.push(obj);
      lastTextId = obj.id;
      drawAll();
      drawLive();
      markDirty();
      return;
    }

    var idx = st.original ? objectIndex(st.original.id) : -1;
    if (idx < 0) {
      if (!raw.trim()) {
        drawAll();
        drawLive();
        return;
      }
      var orphan = cloneObject(st.obj);
      orphan.text = raw;
      orphan.manual = true;
      var keepOrphanH = orphan.h || 0;
      fitEditingTextBox(orphan);
      orphan.h = Math.max(orphan.h, keepOrphanH);
      pushHistory();
      page.objects.push(orphan);
      lastTextId = orphan.id;
      drawAll();
      drawLive();
      markDirty();
      return;
    }

    if (!raw.trim()) {
      pushHistory();
      page.objects.splice(idx, 1);
      if (lastTextId === st.original.id) lastTextId = null;
      drawAll();
      drawLive();
      markDirty();
      return;
    }

    var next = cloneObject(st.obj);
    next.text = raw;
    next.manual = true;
    var keepNextH = next.h || 0;
    fitEditingTextBox(next);
    next.h = Math.max(next.h, keepNextH);
    var old = page.objects[idx];
    if (
      old.text === next.text &&
      old.fontSize === next.fontSize &&
      old.color === next.color &&
      Math.abs((old.w || 0) - next.w) < 1 &&
      Math.abs((old.h || 0) - next.h) < 1
    ) {
      drawAll();
      drawLive();
      return;
    }
    pushHistory();
    page.objects[idx] = next;
    lastTextId = next.id;
    if (selectedId === st.original.id) selectedId = next.id;
    drawAll();
    drawLive();
    markDirty();
  }

  function cancelText() {
    if (!textState) return;
    var st = textState;
    textState = null;
    el.textEdit.hidden = true;
    el.textEdit.value = "";
    if (st.removed && st.original) {
      var at = clamp(st.index, 0, page.objects.length);
      page.objects.splice(at, 0, st.original);
    }
    drawAll();
    drawLive();
  }

  /* 直接 Ctrl+V 粘贴文字：在当前视野中间生成一个可拖动、可拖边改大小的文字框 */
  function insertTextContent(text) {
    text = String(text || "").replace(/\r\n/g, "\n");
    if (!text.trim()) return;
    commitText();
    var center = worldOfScreen(view.w / 2, view.h / 2);
    var img = imageAt(center.x, center.y);
    var obj = {
      id: uid(),
      type: "text",
      x: 0,
      y: 0,
      fontSize: textFontSize(),
      color: color,
      text: text,
      lines: [],
      w: 0,
      h: 0,
      manual: true,
      parentId: img ? img.id : ""
    };
    initTextBox(obj);
    // 粘贴后按内容一次性撑到完整高度，所有文字直接显示，不在框内滚动
    var lay = textLayout(obj, obj.w);
    obj.h = Math.max(defaultTextHeight(obj.fontSize), lay.contentH + TEXT_PAD * 2);
    relayoutTextBox(obj);
    obj.x = clamp(center.x - obj.w / 2, 0, Math.max(0, boardWidth() - obj.w));
    obj.y = Math.max(0, center.y - obj.h / 2);
    pushHistory();
    page.objects.push(obj);
    setTool("select");
    selectedId = obj.id;
    lastTextId = obj.id;
    drawAll();
    drawLive();
    markDirty();
    showToast("已粘贴文字，可拖动或拖边框改大小");
  }

  /* ------------------------------- 标题 ------------------------------- */

  /* 新白板默认名字：当前年月日时，例如 2026-11-18 15时 */
  function timePageName(ts) {
    var d = new Date(ts || Date.now());
    function p(n) {
      return (n < 10 ? "0" : "") + n;
    }
    return (
      d.getFullYear() +
      "-" +
      p(d.getMonth() + 1) +
      "-" +
      p(d.getDate()) +
      " " +
      p(d.getHours()) +
      "时"
    );
  }

  function renderChrome() {
    if (!page || !doc) return;
    if (el.title) {
      el.title.textContent = page.name;
      el.title.title = "点击重命名：" + page.name;
    }
    syncThemeUi();
    syncHistoryUi();
    syncToolUi();
    syncColorUi();
    syncWidthUi();
    syncFillUi();
  }

  function startRename() {
    if (!page || titleEditing) return;
    titleEditing = true;
    el.title.hidden = true;
    el.titleInput.hidden = false;
    el.titleInput.value = page.name;
    el.titleInput.focus();
    el.titleInput.select();
  }

  function finishRename(ok) {
    if (!titleEditing) return;
    titleEditing = false;
    var value = el.titleInput.value.trim().slice(0, 24);
    el.titleInput.hidden = true;
    el.title.hidden = false;
    if (ok && value && page) {
      page.name = value;
      markDirty();
    }
    if (el.title) el.title.focus();
    renderChrome();
  }

  /* ------------------------------- 工具 UI ------------------------------- */

  function setTool(id, silent) {
    if (placingGap) cancelGapPlacement();
    var valid = false;
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === id && !TOOLS[i].action) valid = true;
    }
    if (!valid) return;
    if (textState) commitText();
    tool = id;
    wheelSizeAcc = 0;
    if (toolWidths[id] != null) width = toolWidths[id];
    if (id !== "select" && id !== "text") lastTextId = null;
    // V / 选择工具会保留圈选结果，其它工具切换时收起圈选
    if (id !== "select" && lassoIds.length) clearLasso(false);
    if (id !== "select") {
      selectedId = null;
      drawLive();
    }
    stage.dataset.tool = id;
    syncToolUi();
    syncWidthUi();
    if (el.fillBtn) {
      el.fillBtn.hidden = !(id === "rect" || id === "ellipse");
    }
    if (!silent) saveSettings();
  }

  function syncToolUi() {
    if (!el.tools) return;
    var btns = el.tools.querySelectorAll("[data-tool]");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.tool === tool;
      btns[i].classList.toggle("is-on", on);
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    stage.dataset.tool = tool;
    if (el.fillBtn) {
      el.fillBtn.hidden = !(tool === "rect" || tool === "ellipse");
    }
  }

  function deactivateActiveTool() {
    if (!page) return;
    if (textState) commitText();
    var hadSelection = !!selectedId || lassoIds.length > 0;
    selectedId = null;
    clearLasso(false);
    lastTextId = null;
    if (tool !== "select") setTool("select");
    if (hadSelection) {
      drawAll();
      drawLive();
    }
  }

  function buildTools() {
    if (!el.tools) return;
    TOOLS.forEach(function (t) {
      if (t.sep) {
        var sep = document.createElement("span");
        sep.className = "cwb-tool__sep";
        sep.setAttribute("aria-hidden", "true");
        el.tools.appendChild(sep);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cwb-tool";
      b.dataset.tool = t.id;
      b.title = t.title || (t.name + (t.key ? "（" + t.key + "）" : ""));
      if (SIZE_WHEEL_TOOLS[t.id]) {
        b.title += " · 选中后在画布滚轮调大小 · 右键取消";
      }
      b.setAttribute("aria-label", t.name);
      b.setAttribute("aria-pressed", "false");
      b.innerHTML = t.icon;
      if (t.key && t.key !== "Space") {
        var key = document.createElement("span");
        key.className = "cwb-tool__key";
        key.textContent = t.key;
        b.appendChild(key);
      }
      b.addEventListener("click", function () {
        if (t.action === "image") {
          pickImage();
          return;
        }
        setTool(t.id);
        try {
          base.focus({ preventScroll: true });
        } catch (err) {
          base.focus();
        }
      });
      b.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (tool === t.id) deactivateActiveTool();
      });
      el.tools.appendChild(b);
    });
  }

  var colorButtons = [];
  var customColorInput = null;

  function buildColors() {
    if (!el.colors) return;
    colorButtons = [];
    COLORS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cwb-color";
      b.dataset.color = c.hex;
      b.title = c.name;
      b.setAttribute("aria-label", "颜色：" + c.name);
      b.innerHTML = '<span class="cwb-color__dot"></span>';
      b.querySelector(".cwb-color__dot").style.setProperty("--cwb-swatch", c.hex);
      b.addEventListener("click", function () {
        setColor(c.hex);
        closePopovers();
      });
      el.colors.appendChild(b);
      colorButtons.push(b);
    });
    var label = document.createElement("label");
    label.className = "cwb-color cwb-color--custom";
    label.title = "自定义颜色";
    label.innerHTML =
      '<span class="cwb-color__dot"></span>' +
      '<input type="color" value="#1f2937" aria-label="自定义颜色">';
    customColorInput = label.querySelector("input");
    customColorInput.addEventListener("input", function () {
      setColor(customColorInput.value);
    });
    customColorInput.addEventListener("change", function () {
      closePopovers();
    });
    el.colors.appendChild(label);
  }

  function setColor(hex, opts) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    color = hex.toLowerCase();
    if (!opts || opts.recolor !== false) recolorActiveInk(color);
    syncColorUi();
    saveSettings();
  }

  /* 点颜色时：正在编辑的文字、选中的文字 / 线条 / 形状、或刚编辑过的文字都跟着换色，
     不需要先在文字框里选中内容。 */
  function recolorActiveInk(hex) {
    if (!page) return false;
    if (textState) {
      textState.obj.color = hex;
      applyTextStyle();
      drawAll();
      drawLive();
      return true;
    }
    if (lassoIds.length) {
      var lassoList = lassoObjects();
      var inkTypes = {
        text: 1,
        pen: 1,
        highlighter: 1,
        line: 1,
        arrow: 1,
        rect: 1,
        ellipse: 1
      };
      var targets = [];
      for (var li = 0; li < lassoList.length; li++) {
        if (
          inkTypes[lassoList[li].type] &&
          String(lassoList[li].color).toLowerCase() !== hex.toLowerCase()
        ) {
          targets.push(lassoList[li]);
        }
      }
      if (!targets.length) return false;
      pushHistory();
      for (var lj = 0; lj < targets.length; lj++) {
        var lidx = objectIndex(targets[lj].id);
        if (lidx < 0) continue;
        var lc = cloneObject(targets[lj]);
        lc.color = hex;
        page.objects[lidx] = lc;
      }
      drawAll();
      drawLive();
      markDirty();
      return true;
    }
    var target = null;
    if (selectedId) {
      var sel = findObject(selectedId);
      if (
        sel &&
        (sel.type === "text" ||
          sel.type === "pen" ||
          sel.type === "highlighter" ||
          sel.type === "line" ||
          sel.type === "arrow" ||
          sel.type === "rect" ||
          sel.type === "ellipse")
      ) {
        target = sel;
      }
    }
    if (!target && lastTextId) {
      var last = findObject(lastTextId);
      if (last && last.type === "text") target = last;
    }
    if (!target) return false;
    if (String(target.color).toLowerCase() === hex.toLowerCase()) return false;
    pushHistory();
    var idx = objectIndex(target.id);
    var copy = cloneObject(target);
    copy.color = hex;
    page.objects[idx] = copy;
    if (copy.type === "text") lastTextId = copy.id;
    if (selectedId === target.id) selectedId = copy.id;
    drawAll();
    drawLive();
    markDirty();
    return true;
  }

  function syncColorUi() {
    var found = false;
    if (el.colorDot) el.colorDot.style.background = color;
    for (var i = 0; i < colorButtons.length; i++) {
      var on = colorButtons[i].dataset.color.toLowerCase() === color.toLowerCase();
      if (on) found = true;
      colorButtons[i].classList.toggle("is-on", on);
    }
    if (customColorInput) {
      try {
        customColorInput.value = color;
      } catch (err) {}
      var label = customColorInput.parentNode;
      if (label) label.classList.toggle("is-on", !found);
    }
  }

  var widthButtons = [];

  function buildWidths() {
    if (!el.widths) return;
    widthButtons = [];
    WIDTHS.forEach(function (w) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cwb-width";
      b.dataset.w = w;
      b.title = "粗细 " + w;
      b.setAttribute("aria-label", "粗细 " + w);
      b.innerHTML = '<span class="cwb-width__dot"></span>';
      b.addEventListener("click", function () {
        setWidth(w);
      });
      el.widths.appendChild(b);
      widthButtons.push(b);
    });
  }

  function setWidth(w) {
    w = Number(w);
    if (!isFinite(w)) return;
    width = clamp(Math.round(w), 1, 40);
    if (tool === "text") textSizeCustomized = true;
    if (toolWidths[tool] != null) toolWidths[tool] = width;
    if (tool === "text") {
      var fontPx = 14 + width * 4;
      var target = currentTextObject();
      if (target) {
        if (textState) {
          textState.obj.fontSize = fontPx;
          fitEditingTextBox(textState.obj);
          applyTextStyle();
          drawAll();
          drawLive();
        } else if (Math.round(target.fontSize) !== fontPx) {
          pushHistory();
          var ti = objectIndex(target.id);
          if (ti >= 0) {
            var tc = cloneObject(target);
            tc.fontSize = fontPx;
            tc.manual = true;
            tc.lines = [];
            relayoutTextBox(tc);
            page.objects[ti] = tc;
            lastTextId = tc.id;
            if (selectedId === target.id) selectedId = tc.id;
            drawAll();
            drawLive();
            markDirty();
          }
        }
      }
    }
    syncWidthUi();
    saveSettings();
  }

  function syncWidthUi() {
    var textMode = tool === "text";
    for (var i = 0; i < widthButtons.length; i++) {
      var w = Number(widthButtons[i].dataset.w);
      var on = w === width;
      widthButtons[i].classList.toggle("is-on", on);
      widthButtons[i].title = textMode
        ? "字号 " + (14 + w * 4)
        : "粗细 " + w;
      widthButtons[i].setAttribute("aria-label", widthButtons[i].title);
    }
  }

  function setFill(on) {
    fillShape = !!on;
    syncFillUi();
    saveSettings();
  }

  function syncFillUi() {
    if (!el.fillBtn) return;
    el.fillBtn.setAttribute("aria-pressed", fillShape ? "true" : "false");
    el.fillBtn.hidden = !(tool === "rect" || tool === "ellipse");
  }

  function saveSettings() {
    if (!doc || !loaded) return;
    doc.settings = {
      tool: tool,
      color: color,
      width: width,
      widths: toolWidths,
      textSizeCustomized: textSizeCustomized,
      fill: fillShape
    };
    markDirty();
  }

  function applySettings(s) {
    s = sanitizeSettings(s);
    tool = s.tool;
    color = s.color;
    toolWidths = s.widths;
    textSizeCustomized = !!s.textSizeCustomized;
    width = s.width;
    fillShape = s.fill;
    syncToolUi();
    syncColorUi();
    syncWidthUi();
    syncFillUi();
  }

  /* ------------------------------- 内容边界 ------------------------------- */

  function contentBounds() {
    if (!page || !page.objects.length) return null;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < page.objects.length; i++) {
      var o = page.objects[i];
      if (o.type === "eraser") continue;
      var b = objectBounds(o);
      if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.w) || !isFinite(b.h)) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX)) return null;
    return {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY)
    };
  }

  /* ------------------------------- 图片 ------------------------------- */

  function getImage(src) {
    if (!src || src.indexOf("data:image/") !== 0) return null;
    if (!imageCache[src]) {
      var img = new Image();
      var rec = { img: img, ready: false, error: false };
      imageCache[src] = rec;
      img.onload = function () {
        rec.ready = true;
        if (isOpen) {
          drawAll();
          drawLive();
        }
      };
      img.onerror = function () {
        rec.error = true;
      };
      img.src = src;
    }
    return imageCache[src];
  }

  function whenImageReady(src) {
    var rec = getImage(src);
    if (!rec || rec.ready || rec.error) return Promise.resolve();
    return new Promise(function (resolve) {
      rec.img.addEventListener("load", resolve, { once: true });
      rec.img.addEventListener("error", resolve, { once: true });
    });
  }

  function ensureImages() {
    if (!page) return Promise.resolve();
    var jobs = [];
    for (var i = 0; i < page.objects.length; i++) {
      if (page.objects[i].type === "image") jobs.push(whenImageReady(page.objects[i].src));
    }
    return Promise.all(jobs);
  }

  function readImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("不是图片文件"));
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        reject(new Error("图片超过 12MB，换一张小一点的"));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error("图片读不出来");
          var fr = new FileReader();
          fr.onload = function () {
            URL.revokeObjectURL(url);
            if (typeof fr.result !== "string" || fr.result.length > 6000000) {
              reject(new Error("图片太大，本地空间存不下"));
              return;
            }
            // 所有格式都保留原始文件字节，不重编码、不缩尺寸
            resolve({ src: fr.result, w: w, h: h, ow: w, oh: h });
          };
          fr.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error("图片读取失败"));
          };
          fr.readAsDataURL(file);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败"));
      };
      img.src = url;
    });
  }

  function insertImages(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && /^image\//.test(f.type || "");
    });
    if (!list.length) {
      showToast("没有可用的图片文件");
      return;
    }
    list = list.slice(0, 6);
    var center = worldOfScreen(view.w / 2, view.h / 2);
    center.x = clamp(center.x, 0, boardWidth());
    Promise.all(list.map(readImageFile))
      .then(function (imgs) {
        if (!page) return;
        pushHistory();
        var last = null;
        var W = boardWidth();
        imgs.forEach(function (im, i) {
          // 1 个图片像素 = 1 个屏幕物理像素；屏幕倍率越高，CSS 尺寸越小但绝对清晰
          var ow = im.ow || im.w;
          var oh = im.oh || im.h;
          var dpr = Math.max(1, view.dpr || window.devicePixelRatio || 1);
          var cssW = ow / dpr;
          if (cssW > W) cssW = W;
          var w = Math.max(1, Math.round(cssW));
          var h = Math.max(1, Math.round(oh * (w / ow)));
          var x = Math.round(center.x - w / 2 + i * 26);
          var y = Math.round(center.y - h / 2 + i * 26);
          x = clamp(x, 0, Math.max(0, W - w));
          if (y < 0) y = 0;
          var o = {
            id: uid(),
            type: "image",
            x: x,
            y: y,
            w: w,
            h: h,
            src: im.src
          };
          page.objects.push(o);
          last = o;
        });
        setTool("select");
        if (last) selectedId = last.id;
        drawAll();
        drawLive();
        markDirty();
        showToast(imgs.length + " 张图片已插入，可以直接拖动");
      })
      .catch(function (err) {
        showToast(err && err.message ? err.message : "图片插入失败");
      });
  }

  function cancelGapPlacement() {
    if (!placingGap) return;
    placingGap = false;
    if (el.extendBtn) {
      el.extendBtn.classList.remove("is-armed");
      el.extendBtn.setAttribute("aria-pressed", "false");
    }
    stage.classList.remove("is-placing-panel");
  }

  function startGapPlacement() {
    if (!page) return;
    if (placingGap) {
      cancelGapPlacement();
      hideToast();
      return;
    }
    if (textState) commitText();
    closePopovers();
    setTool("select");
    placingGap = true;
    if (el.extendBtn) {
      el.extendBtn.classList.add("is-armed");
      el.extendBtn.setAttribute("aria-pressed", "true");
    }
    stage.classList.add("is-placing-panel");
    showToast("点击白板插入约 1.25 屏空白，右键取消", "取消", cancelGapPlacement, 8000);
  }

  function insertGapAt(p) {
    if (!page) return;
    var gap = Math.max(160, Math.round((view.h * 1.25) / (page.cam.scale || 1)));
    var lineY = Math.max(0, Math.round(p.y));
    var moved = [];
    for (var i = 0; i < page.objects.length; i++) {
      var o = page.objects[i];
      var b = objectBounds(o);
      if (!isFinite(b.y) || b.y < lineY - 0.5) continue;
      moved.push({ index: i, obj: o });
    }
    cancelGapPlacement();
    setTool("select");
    if (!moved.length) {
      showToast("点击位置下面没有内容，直接往下写即可");
      return;
    }
    pushHistory();
    for (var j = 0; j < moved.length; j++) {
      var m = cloneObject(moved[j].obj);
      if (m.type === "pen" || m.type === "highlighter" || m.type === "eraser") {
        for (var k = 0; k < m.points.length; k++) m.points[k].y += gap;
      } else if (
        m.type === "line" ||
        m.type === "arrow" ||
        m.type === "rect" ||
        m.type === "ellipse"
      ) {
        m.y1 += gap;
        m.y2 += gap;
      } else if (m.type === "panel" || m.type === "text" || m.type === "image") {
        m.y += gap;
      }
      page.objects[moved[j].index] = m;
    }
    selectedId = null;
    lastTextId = null;
    drawAll();
    drawLive();
    markDirty();
    showToast("已在点击处插入约 1.25 屏空白，下面内容整体下移");
  }

  function pickImage() {
    if (el.imageInput) {
      el.imageInput.value = "";
      el.imageInput.click();
    }
  }

  /* ------------------------------ 导出 / 导入 ------------------------------ */

  function downloadBlob(blob, name) {
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 5000);
    } catch (err) {
      showToast("浏览器阻止了下载，请用电脑浏览器重试");
    }
  }

  function exportJson() {
    if (!loaded || !doc || !page) return;
    var payload = {
      app: "chan-whiteboard",
      v: 1,
      exportedAt: new Date().toISOString(),
      updatedAt: doc.updatedAt,
      activeId: page.id,
      pages: doc.pages,
      settings: doc.settings
    };
    try {
      var text = JSON.stringify(payload, null, 2);
      downloadBlob(
        new Blob([text], { type: "application/json;charset=utf-8" }),
        "缠论白板-" + safeName(page.name) + "-" + stamp() + ".json"
      );
      showToast("工程文件已导出，换设备也能打开");
    } catch (err) {
      showToast("导出失败：内容太大，试试先删掉一些图片");
    }
  }

  function exportPng() {
    if (!page) return;
    commitText();
    if (!page.objects.length) {
      showToast("白板还是空的，先画点什么");
      return;
    }
    ensureImages().then(function () {
      var b = contentBounds();
      if (!b) return;
      var pad = 48;
      b.x -= pad;
      b.y -= pad;
      b.w += pad * 2;
      b.h += pad * 2;
      // 1:1 导出，避免把低分辨率图片再放大；超长白板最多 12000px 再等比缩
      var scale = Math.min(1, 12000 / Math.max(b.w, b.h));
      scale = Math.max(0.08, scale);
      var cw = Math.max(1, Math.round(b.w * scale));
      var ch = Math.max(1, Math.round(b.h * scale));
      var c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      var cx = c.getContext("2d");
      var th = theme();
      cx.clearRect(0, 0, cw, ch);
      cx.save();
      cx.scale(scale, scale);
      cx.translate(-b.x, -b.y);
      for (var i = 0; i < page.objects.length; i++) {
        drawObject(cx, page.objects[i]);
      }
      cx.restore();
      // 橡皮在内容层擦出透明洞；纸底最后垫到底下，导出图不会漏透明。
      cx.save();
      cx.globalCompositeOperation = "destination-over";
      cx.fillStyle = th.fill;
      cx.fillRect(0, 0, cw, ch);
      cx.restore();
      c.toBlob(
        function (blob) {
          if (!blob) {
            showToast("PNG 导出失败");
            return;
          }
          downloadBlob(
            blob,
            "白板-" + safeName(page.name) + "-" + stamp() + ".png"
          );
          showToast("图片已导出：" + cw + " × " + ch);
        },
        "image/png"
      );
    });
  }

  function askConfirm(title, text, okLabel) {
    if (!el.confirm) return Promise.resolve(false);
    if (confirmState) {
      var old = confirmState.resolve;
      confirmState = null;
      old(false);
    }
    el.confirmTitle.textContent = title;
    el.confirmText.textContent = text;
    el.confirmOk.textContent = okLabel || "确定";
    el.confirm.hidden = false;
    closePopovers();
    try {
      el.confirmOk.focus();
    } catch (err) {}
    return new Promise(function (resolve) {
      confirmState = { resolve: resolve };
    });
  }

  function settleConfirm(ok) {
    if (!confirmState) return;
    var resolve = confirmState.resolve;
    confirmState = null;
    el.confirm.hidden = true;
    resolve(!!ok);
  }

  function clearPage() {
    if (!page) return;
    commitText();
    if (!page.objects.length) {
      showToast("白板已经是空的");
      return;
    }
    pushHistory();
    page.objects = [];
    selectedId = null;
    clearLasso(false);
    lastTextId = null;
    drawAll();
    drawLive();
    markDirty();
    showToast("已清空白板，按 Ctrl+Z 可以撤回");
  }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var raw;
      try {
        raw = JSON.parse(String(reader.result));
      } catch (err) {
        showToast("这个文件不是有效的白板工程（JSON）");
        return;
      }
      if (!raw || !Array.isArray(raw.pages) || !raw.pages.length) {
        showToast("文件里没有可用的白板内容");
        return;
      }
      var next = normalizeDoc(raw);
      if (!next) {
        showToast("文件内容无法识别");
        return;
      }
      askConfirm(
        "打开工程文件",
        "将用「" +
          file.name +
          "」里的内容替换当前白板。当前内容如果还没导出，会丢失。",
        "打开并替换"
      ).then(function (ok) {
        if (!ok) return;
        cancelText();
        cancelGesture();
        doc = next;
        doc.activeId = next.activeId;
        page = activePage();
        histories = {};
        selectedId = null;
        clearLasso(false);
        lastTextId = null;
        imageCache = {};
        applySettings(doc.settings);
        renderChrome();
        resize();
        drawAll();
        drawLive();
        markDirty();
        saveNow();
        showToast("已打开工程文件");
      });
    };
    reader.onerror = function () {
      showToast("文件读取失败");
    };
    reader.readAsText(file);
  }

  /* ------------------------------ 交互手势 ------------------------------ */

  function cancelGesture() {
    if (!action) return;
    if (action.kind === "move" && action.moved) {
      for (var i = 0; i < action.origGroup.length; i++) {
        page.objects[action.origGroup[i].index] = action.origGroup[i].obj;
      }
    }
    if (action.kind === "resize" && action.moved) {
      for (var ri = 0; ri < action.group.length; ri++) {
        page.objects[action.group[ri].index] = action.group[ri].obj;
      }
    }
    if (action.kind === "resize-text" && action.moved) {
      page.objects[action.index] = action.orig;
    }
    if (action.kind === "resize-panel" && action.moved) {
      page.objects[action.index] = action.orig;
    }
    if (action.kind === "resize-line" && action.moved) {
      page.objects[action.index] = action.orig;
    }
    action = null;
    draft = null;
    pointers = {};
    pinchState = null;
    stage.classList.remove("is-panning");
    stage.classList.remove("is-grabbing");
    drawLive();
  }

  function setSpaceMode(on) {
    spaceDown = !!on;
    if (spaceDown) stage.classList.add("is-grabbing");
    else stage.classList.remove("is-grabbing");
    if (on) {
      try {
        base.focus({ preventScroll: true });
      } catch (err) {}
    }
  }

  function onPointerDown(e) {
    if (!page || !isOpen) return;
    if (el.confirm && !el.confirm.hidden) return;
    if (el.help && !el.help.hidden) return;
    if (e.button === 2) return;
    if (e.pointerType === "touch" && Date.now() - lastPenAt < 900) return;

    closePopovers();

    if (textState) commitText();

    if (e.pointerType === "touch") {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 2) {
        // cancelGesture 会顺带清掉 pointers，这里先把两根手指的位置留住
        var keptPointers = pointers;
        cancelGesture();
        pointers = keptPointers;
        startPinch();
        e.preventDefault();
        return;
      }
      if (Object.keys(pointers).length > 2) return;
    } else if (e.pointerType === "pen") {
      lastPenAt = Date.now();
    }

    if (action) return;
    e.preventDefault();
    try {
      live.setPointerCapture(e.pointerId);
    } catch (err) {}
    try {
      base.focus({ preventScroll: true });
    } catch (err) {}

    var sp = screenPoint(e);
    var p = worldPoint(e);

    if (placingGap) {
      insertGapAt(p);
      return;
    }

    var parentImage = imageAt(p.x, p.y);

    if (e.button === 1 || spaceDown || tool === "hand") {
      action = {
        kind: "pan",
        sx: sp.x,
        sy: sp.y,
        camX: page.cam.x,
        camY: page.cam.y
      };
      stage.classList.add("is-panning");
      return;
    }

    if (tool === "laser") {
      action = { kind: "laser" };
      startLaser();
      addLaserPoint(sp);
      return;
    }

    // 左右边界外不落笔；选择工具在边界外只取消选中，激光笔不受影响
    var boardRight = page.cam.x + boardWidth() * page.cam.scale;
    if (
      (sp.x < page.cam.x || sp.x > boardRight) &&
      tool !== "laser"
    ) {
      if (tool === "select") {
        selectedId = null;
        clearLasso(false);
        drawLive();
      } else if (tool === "lasso") {
        clearLasso(false);
        drawLive();
      }
      return;
    }

    if (tool === "lasso") {
      selectedId = null;
      lastTextId = null;
      clearLasso(false);
      action = {
        kind: "lasso",
        points: [{ x: clamp(p.x, 0, boardWidth()), y: Math.max(0, p.y) }]
      };
      drawLive();
      return;
    }

    // 直线 / 箭头端点在任意工具下都能直接拖；不必先切回选择工具
    var handleObj = findObject(selectedId);
    if (!handleObj || (handleObj.type !== "line" && handleObj.type !== "arrow")) {
      var maybeLine = hitTest(p.x, p.y, false);
      if (maybeLine && (maybeLine.type === "line" || maybeLine.type === "arrow")) {
        handleObj = maybeLine;
      }
    }
    if (handleObj && (handleObj.type === "line" || handleObj.type === "arrow")) {
      var handleEnd = lineHandleAt(handleObj, sp);
      if (handleEnd) {
        selectedId = handleObj.id;
        lassoIds = [];
        action = {
          kind: "resize-line",
          id: handleObj.id,
          index: objectIndex(handleObj.id),
          orig: cloneObject(handleObj),
          start: p,
          end: handleEnd,
          moved: false
        };
        drawAll();
        drawLive();
        return;
      }
    }

    if (tool === "select") {
      if (lassoIds.length) {
        if (lassoPointHit(p.x, p.y)) {
          var lassoList = lassoObjects();
          action = {
            kind: "move",
            id: "",
            lasso: true,
            origGroup: lassoList.map(function (o) {
              return { index: objectIndex(o.id), obj: o };
            }),
            origBounds: groupBounds(lassoList),
            start: p,
            moved: false
          };
          drawLive();
          return;
        }
        // 点在圈选范围外：先收起圈选，再按普通点击处理
        clearLasso(false);
      }
      var selected = findObject(selectedId);
      if (selected && selected.type === "image" && imageHandleHit(selected, sp)) {
        var idx = objectIndex(selected.id);
        var resizeGroup = groupObjects(selected);
        var gb = groupBounds(resizeGroup);
        action = {
          kind: "resize",
          id: selected.id,
          index: idx,
          orig: selected,
          start: p,
          w0: selected.w,
          h0: selected.h,
          group: resizeGroup.map(function (o) {
            return { index: objectIndex(o.id), obj: o };
          }),
          rel: {
            minX: gb.x - selected.x,
            maxX: gb.x + gb.w - selected.x,
            minY: gb.y - selected.y
          },
          moved: false
        };
        return;
      }
      if (selected && selected.type === "text") {
        var dir = textHandleAt(selected, sp);
        if (dir) {
          action = {
            kind: "resize-text",
            id: selected.id,
            index: objectIndex(selected.id),
            orig: selected,
            start: p,
            dir: dir,
            moved: false
          };
          return;
        }
      }
      if (selected && selected.type === "panel") {
        var pdir = panelHandleAt(selected, sp);
        if (pdir) {
          action = {
            kind: "resize-panel",
            id: selected.id,
            index: objectIndex(selected.id),
            orig: cloneObject(selected),
            start: p,
            dir: pdir,
            moved: false
          };
          return;
        }
      }
      var hit = hitTest(p.x, p.y, false);
      if (!hit) {
        // 选择工具在空白处拖一圈，也能直接圈选；只点一下等于取消选择
        selectedId = null;
        lastTextId = null;
        action = {
          kind: "lasso",
          points: [{ x: clamp(p.x, 0, boardWidth()), y: Math.max(0, p.y) }]
        };
        drawLive();
        return;
      }
      selectedId = hit.id;
      if (hit.type === "text") lastTextId = hit.id;
      else lastTextId = null;
      var list = groupObjects(hit);
      action = {
        kind: "move",
        id: hit.id,
        origGroup: list.map(function (o) {
          return { index: objectIndex(o.id), obj: o };
        }),
        origBounds: groupBounds(list),
        start: p,
        moved: false
      };
      drawLive();
      return;
    }

    if (tool === "text") {
      var existing = hitTest(p.x, p.y, false, true);
      if (existing && existing.type === "text") {
        beginText(existing.x, existing.y, existing);
      } else {
        beginText(p.x, p.y, null, parentImage ? parentImage.id : null);
      }
      return;
    }

    if (tool === "eraser") {
      var eraserObj = {
        id: uid(),
        type: "eraser",
        color: "#000000",
        width: eraserRadius() * 2,
        points: [p],
        parentId: parentImage ? parentImage.id : ""
      };
      pushHistory();
      page.objects.push(eraserObj);
      action = { kind: "erase", id: eraserObj.id };
      hoverPoint = sp;
      drawAll();
      drawLive();
      return;
    }

    var isShape =
      tool === "line" || tool === "arrow" || tool === "rect" || tool === "ellipse";
    if (selectedId) {
      selectedId = null;
      lastTextId = null;
    }
    if (tool === "pen" || tool === "highlighter") {
      draft = {
        id: uid(),
        type: tool,
        color: color,
        width: width,
        points: [p],
        parentId: parentImage ? parentImage.id : ""
      };
    } else if (isShape) {
      draft = {
        id: uid(),
        type: tool,
        color: color,
        width: width,
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        fill: (tool === "rect" || tool === "ellipse") && fillShape,
        fromCenter: false,
        parentId: parentImage ? parentImage.id : ""
      };
    } else {
      return;
    }
    action = { kind: "draw" };
    drawLive();
  }

  function addDraftPoint(e) {
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (!evs.length) evs = [e];
    var pts = draft.points;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i] || e;
      var p = worldPoint(ev);
      var last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.1 / page.cam.scale) {
        continue;
      }
      pts.push({ x: p.x, y: p.y });
    }
  }

  function updateDraft(e) {
    if (!draft) return;
    if (draft.type === "pen" || draft.type === "highlighter") {
      addDraftPoint(e);
    } else {
      var p = worldPoint(e);
      var dx = p.x - draft.x1;
      var dy = p.y - draft.y1;
      var shift = e.shiftKey;
      if (draft.type === "line" || draft.type === "arrow") {
        if (shift) {
          var ang = Math.atan2(dy, dx);
          var step = Math.PI / 4;
          ang = Math.round(ang / step) * step;
          var len = Math.hypot(dx, dy);
          dx = Math.cos(ang) * len;
          dy = Math.sin(ang) * len;
        }
        draft.x2 = draft.x1 + dx;
        draft.y2 = draft.y1 + dy;
      } else {
        if (shift) {
          var mx = Math.max(Math.abs(dx), Math.abs(dy));
          dx = (dx < 0 ? -1 : 1) * mx;
          dy = (dy < 0 ? -1 : 1) * mx;
        }
        draft.fromCenter = !!e.altKey;
        draft.x2 = draft.x1 + (draft.fromCenter ? -dx : dx);
        draft.y2 = draft.y1 + (draft.fromCenter ? -dy : dy);
      }
      draft.x2 = clamp(draft.x2, 0, boardWidth());
      draft.y2 = Math.max(0, draft.y2);
    }
    drawLive();
  }

  function simplifyPoints(points, tol) {
    if (points.length <= 2) return points;
    var sq = tol * tol;
    var out = [points[0]];
    for (var i = 1; i < points.length - 1; i++) {
      var prev = out[out.length - 1];
      var dx = points[i].x - prev.x;
      var dy = points[i].y - prev.y;
      if (dx * dx + dy * dy > sq) out.push(points[i]);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function finalizeShape() {
    var x1 = draft.x1;
    var y1 = draft.y1;
    if (draft.fromCenter) {
      x1 = 2 * draft.x1 - draft.x2;
      y1 = 2 * draft.y1 - draft.y2;
    }
    var o = {
      id: draft.id,
      type: draft.type,
      color: draft.color,
      width: draft.width,
      x1: round2(x1),
      y1: round2(y1),
      x2: round2(draft.x2),
      y2: round2(draft.y2)
    };
    if (draft.parentId) o.parentId = draft.parentId;
    if (draft.type === "rect" || draft.type === "ellipse") o.fill = !!draft.fill;
    return o;
  }

  function commitDraft() {
    if (!draft) return;
    var o = null;
    if (draft.type === "pen" || draft.type === "highlighter") {
      if (!draft.points.length) return;
      var pts = simplifyPoints(draft.points, 0.6 / page.cam.scale);
      pts = pts.map(function (p) {
        return { x: round2(p.x), y: round2(p.y) };
      });
      o = {
        id: draft.id,
        type: draft.type,
        color: draft.color,
        width: draft.width,
        points: pts
      };
      if (draft.parentId) o.parentId = draft.parentId;
    } else {
      var dx = draft.x2 - draft.x1;
      var dy = draft.y2 - draft.y1;
      if (Math.hypot(dx, dy) < 3 / page.cam.scale) return;
      o = finalizeShape();
    }
    pushHistory();
    page.objects.push(o);
    if (
      o.type === "line" ||
      o.type === "arrow" ||
      o.type === "pen" ||
      o.type === "highlighter" ||
      o.type === "rect" ||
      o.type === "ellipse"
    ) {
      selectedId = o.id;
      lastTextId = null;
    }
    drawAll();
    markDirty();
  }

  /* 套索是自由手绘线：去掉过密点、首尾重合点和超长尾巴，再按闭合多边形判定 */
  function lassoPolygon(points) {
    if (!page) return [];
    var minD = 2 / page.cam.scale;
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var last = out[out.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minD) {
        out.push({ x: p.x, y: p.y });
      }
    }
    while (out.length > 2) {
      var a = out[0];
      var z = out[out.length - 1];
      if (Math.hypot(a.x - z.x, a.y - z.y) < minD) out.pop();
      else break;
    }
    if (out.length > 400) {
      var step = out.length / 400;
      var thinned = [];
      for (var j = 0; j < out.length; j += step) {
        thinned.push(out[Math.floor(j)]);
      }
      out = thinned;
    }
    return out;
  }

  function finalizeLasso(points) {
    if (!page) return;
    var poly = lassoPolygon(points || []);
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      minX = Math.min(minX, poly[i].x);
      minY = Math.min(minY, poly[i].y);
      maxX = Math.max(maxX, poly[i].x);
      maxY = Math.max(maxY, poly[i].y);
    }
    var minSize = 7 / page.cam.scale;
    if (poly.length < 3 || maxX - minX < minSize || maxY - minY < minSize) {
      clearLasso(false);
      drawLive();
      return;
    }
    var ids = lassoHitIds(poly);
    if (!ids.length) {
      lassoIds = [];
      selectedId = null;
      lastTextId = null;
      drawLive();
      showToast("圈内没有画线，重新圈一下");
      return;
    }
    lassoIds = ids;
    selectedId = null;
    lastTextId = null;
    // 圈完直接切到选择工具：V 仍然是同一个工具，拖动即可整体移动
    setTool("select", true);
    saveSettings();
    drawLive();
    showToast(
      "已圈选 " + ids.length + " 笔 · 拖动整体移动（V）",
      "取消",
      function () {
        clearLasso(true);
      },
      5200
    );
  }

  function startPinch() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return;
    var a = pointers[ids[0]];
    var b = pointers[ids[1]];
    var r = live.getBoundingClientRect();
    var ca = { x: a.x - r.left, y: a.y - r.top };
    var cb = { x: b.x - r.left, y: b.y - r.top };
    pinchState = {
      cx: (ca.x + cb.x) / 2,
      cy: (ca.y + cb.y) / 2
    };
    action = { kind: "pinch" };
    draft = null;
    drawLive();
  }

  function updatePinch() {
    if (!pinchState) return;
    var ids = Object.keys(pointers);
    if (ids.length < 2) return;
    var a = pointers[ids[0]];
    var b = pointers[ids[1]];
    var r = live.getBoundingClientRect();
    var ca = { x: a.x - r.left, y: a.y - r.top };
    var cb = { x: b.x - r.left, y: b.y - r.top };
    var cx = (ca.x + cb.x) / 2;
    var cy = (ca.y + cb.y) / 2;
    var c = page.cam;
    // 固定 100%：双指只平移，不改变尺寸
    c.x += cx - pinchState.cx;
    c.y += cy - pinchState.cy;
    clampCamera();
    hoverPoint = null;
    pinchState.cx = cx;
    pinchState.cy = cy;
    drawAll();
    drawLive();
  }

  function onPointerMove(e) {
    if (!page || !isOpen) return;
    if (pointers[e.pointerId]) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    }
    if (action && action.kind === "pinch") {
      updatePinch();
      e.preventDefault();
      return;
    }
    var sp = screenPoint(e);
    if (!action) {
      if (tool === "eraser" && e.pointerType !== "touch") {
        hoverPoint = sp;
        drawLive();
      } else if (hoverPoint) {
        hoverPoint = null;
        drawLive();
      }
      return;
    }
    if (action.kind === "pan") {
      page.cam.x = action.camX + (sp.x - action.sx);
      page.cam.y = action.camY + (sp.y - action.sy);
      clampCamera();
      hoverPoint = null;
      drawAll();
      drawLive();
      e.preventDefault();
      return;
    }
    if (action.kind === "draw") {
      updateDraft(e);
      e.preventDefault();
      return;
    }
    if (action.kind === "lasso") {
      var evs2 = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!evs2.length) evs2 = [e];
      var lpts = action.points;
      var minD = 1.5 / page.cam.scale;
      for (var li = 0; li < evs2.length; li++) {
        var lp = worldPoint(evs2[li] || e);
        lp = {
          x: clamp(lp.x, 0, boardWidth()),
          y: Math.max(0, lp.y)
        };
        var lastL = lpts[lpts.length - 1];
        if (
          lpts.length < 1600 &&
          (!lastL || Math.hypot(lp.x - lastL.x, lp.y - lastL.y) >= minD)
        ) {
          lpts.push(lp);
        }
      }
      drawLive();
      e.preventDefault();
      return;
    }
    if (action.kind === "laser") {
      addLaserPoint(sp);
      e.preventDefault();
      return;
    }
    if (action.kind === "erase") {
      hoverPoint = sp;
      var eraserObj = findObject(action.id);
      if (eraserObj) {
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        if (!evs.length) evs = [e];
        var ep = eraserObj.points;
        for (var i = 0; i < evs.length; i++) {
          var wpt = worldPoint(evs[i] || e);
          var last = ep[ep.length - 1];
          if (last && Math.hypot(wpt.x - last.x, wpt.y - last.y) < 0.8 / page.cam.scale) {
            continue;
          }
          ep.push({ x: wpt.x, y: wpt.y });
        }
        drawAll();
        drawLive();
      }
      e.preventDefault();
      return;
    }
    if (action.kind === "move") {
      var p = worldPoint(e);
      var dx = p.x - action.start.x;
      var dy = p.y - action.start.y;
      if (!action.moved) {
        if (Math.hypot(dx, dy) < 1.5 / page.cam.scale) return;
        pushHistory();
        action.moved = true;
      }
      var b = action.origBounds;
      var W = boardWidth();
      if (b.w <= W) {
        if (b.x + dx < 0) dx = -b.x;
        else if (b.x + b.w + dx > W) dx = W - b.x - b.w;
      } else {
        dx = -b.x;
      }
      if (b.y + dy < 0) dy = -b.y;
      for (var mi = 0; mi < action.origGroup.length; mi++) {
        var item = action.origGroup[mi];
        page.objects[item.index] = translateObject(item.obj, dx, dy);
      }
      drawAll();
      drawLive();
      e.preventDefault();
      return;
    }
    if (action.kind === "resize-line") {
      var lp = worldPoint(e);
      var ln = cloneObject(action.orig);
      var lx = clamp(lp.x, 0, boardWidth());
      var ly = Math.max(0, lp.y);
      if (action.end === 1) {
        ln.x1 = lx;
        ln.y1 = ly;
      } else {
        ln.x2 = lx;
        ln.y2 = ly;
      }
      if (!action.moved) {
        pushHistory();
        action.moved = true;
      }
      page.objects[action.index] = ln;
      drawAll();
      drawLive();
      e.preventDefault();
      return;
    }
    if (action.kind === "resize") {
      var rp = worldPoint(e);
      var dw = rp.x - action.start.x;
      var rawS = (action.w0 + dw) / action.w0;
      var minS = Math.max(30 / action.w0, 0.05);
      var maxS = Infinity;
      var W = boardWidth();
      if (action.rel.maxX > 0) {
        maxS = Math.min(maxS, (W - action.orig.x) / action.rel.maxX);
      }
      if (action.rel.minX < 0) {
        maxS = Math.min(maxS, -action.orig.x / action.rel.minX);
      }
      if (action.rel.minY < 0) {
        maxS = Math.min(maxS, -action.orig.y / action.rel.minY);
      }
      if (!isFinite(maxS)) maxS = 6;
      var sx = clamp(rawS, minS, Math.max(minS, maxS));
      if (!action.moved) {
        pushHistory();
        action.moved = true;
      }
      for (var gi = 0; gi < action.group.length; gi++) {
        var ent = action.group[gi];
        if (ent.obj.id === action.orig.id) {
          var img = cloneObject(ent.obj);
          img.w = action.w0 * sx;
          img.h = action.h0 * sx;
          page.objects[ent.index] = img;
        } else {
          page.objects[ent.index] = scaleObjectAbout(
            ent.obj,
            action.orig.x,
            action.orig.y,
            sx,
            sx
          );
        }
      }
      drawAll();
      drawLive();
      e.preventDefault();
      return;
    }
    if (action.kind === "resize-panel") {
      var pp = worldPoint(e);
      var pdx = pp.x - action.start.x;
      var pdy = pp.y - action.start.y;
      var pn = cloneObject(action.orig);
      var pleft = pn.x;
      var ptop = pn.y;
      var pright = pn.x + pn.w;
      var pbottom = pn.y + pn.h;
      var minPW = 160;
      var minPH = 120;
      var PW = boardWidth();
      if (action.dir.indexOf("w") !== -1) {
        pleft = clamp(pn.x + pdx, 0, pright - minPW);
      }
      if (action.dir.indexOf("e") !== -1) {
        pright = clamp(pright + pdx, pleft + minPW, PW);
      }
      if (action.dir.indexOf("n") !== -1) {
        ptop = clamp(pn.y + pdy, 0, pbottom - minPH);
      }
      if (action.dir.indexOf("s") !== -1) {
        pbottom = Math.max(pbottom + pdy, ptop + minPH);
      }
      pn.x = pleft;
      pn.y = ptop;
      pn.w = pright - pleft;
      pn.h = pbottom - ptop;
      if (!action.moved) {
        pushHistory();
        action.moved = true;
      }
      page.objects[action.index] = pn;
      drawAll();
      drawLive();
      e.preventDefault();
      return;
    }
    if (action.kind === "resize-text") {
      var tp = worldPoint(e);
      var tdx = tp.x - action.start.x;
      var tdy = tp.y - action.start.y;
      var t = cloneObject(action.orig);
      var left = t.x;
      var top = t.y;
      var right = t.x + t.w;
      var bottom = t.y + t.h;
      var minW = 60;
      var minH = t.fontSize * 1.4 + TEXT_PAD * 2;
      var W = boardWidth();
      if (action.dir.indexOf("w") !== -1) {
        left = clamp(t.x + tdx, 0, right - minW);
      }
      if (action.dir.indexOf("e") !== -1) {
        right = clamp(right + tdx, left + minW, W);
      }
      if (action.dir.indexOf("n") !== -1) {
        top = clamp(t.y + tdy, 0, bottom - minH);
      }
      if (action.dir.indexOf("s") !== -1) {
        bottom = Math.max(bottom + tdy, top + minH);
      }
      t.x = left;
      t.y = top;
      t.w = right - left;
      t.h = bottom - top;
      t.manual = true;
      relayoutTextBox(t);
      if (!action.moved) {
        pushHistory();
        action.moved = true;
      }
      page.objects[action.index] = t;
      drawAll();
      drawLive();
      e.preventDefault();
    }
  }

  function endGesture(e, cancelled) {
    if (pointers[e.pointerId]) delete pointers[e.pointerId];
    if (action && action.kind === "pinch") {
      if (Object.keys(pointers).length < 2) {
        pinchState = null;
        action = null;
        markDirty();
      }
      return;
    }
    if (!action) return;
    var kind = action.kind;
    if (kind === "draw") {
      if (!cancelled) commitDraft();
      draft = null;
      action = null;
      drawLive();
    } else if (kind === "lasso") {
      var lassoPts = action.points;
      action = null;
      if (!cancelled) finalizeLasso(lassoPts);
      drawLive();
    } else if (kind === "pan") {
      action = null;
      stage.classList.remove("is-panning");
      markDirty();
    } else if (kind === "laser") {
      action = null;
    } else if (kind === "erase") {
      action = null;
      markDirty();
      drawAll();
      drawLive();
    } else if (kind === "move" || kind === "resize" || kind === "resize-text" || kind === "resize-panel" || kind === "resize-line") {
      if (action.moved && !cancelled) {
        markDirty();
      } else if (cancelled && action.moved) {
        if (kind === "move") {
          for (var ci = 0; ci < action.origGroup.length; ci++) {
            page.objects[action.origGroup[ci].index] = action.origGroup[ci].obj;
          }
        } else if (kind === "resize") {
          for (var rj = 0; rj < action.group.length; rj++) {
            page.objects[action.group[rj].index] = action.group[rj].obj;
          }
        } else {
          page.objects[action.index] = action.orig;
        }
        drawAll();
      }
      action = null;
      drawLive();
    } else {
      action = null;
    }
    try {
      live.releasePointerCapture(e.pointerId);
    } catch (err) {}
  }

  function onPointerUp(e) {
    if (!isOpen) return;
    if (pointers[e.pointerId]) {
      delete pointers[e.pointerId];
      if (action && action.kind === "pinch") {
        if (Object.keys(pointers).length < 2) {
          pinchState = null;
          action = null;
          markDirty();
        }
        return;
      }
    }
    endGesture(e, false);
  }

  function onPointerCancel(e) {
    if (!isOpen) return;
    if (pointers[e.pointerId]) delete pointers[e.pointerId];
    if (action && action.kind === "pinch") {
      pinchState = null;
      action = null;
      return;
    }
    endGesture(e, true);
  }

  function toolName(id) {
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === id) return TOOLS[i].name;
    }
    return id;
  }

  function adjustTextSizeByWheel(dy) {
    if (!page) return false;
    wheelSizeAcc += dy;
    if (Math.abs(wheelSizeAcc) < 20) return true;
    var dir = wheelSizeAcc < 0 ? 1 : -1;
    wheelSizeAcc = 0;
    var cur = Math.round(textState ? textState.obj.fontSize : textFontSize());
    var next = clamp(cur + dir * 2, 14, 160);
    if (next === cur) return true;
    textSizeCustomized = true;
    toolWidths.text = clamp((next - 14) / 4, 0, 40);
    width = toolWidths.text;
    if (textState) {
      textState.obj.fontSize = next;
      fitEditingTextBox(textState.obj);
      positionText();
    }
    syncWidthUi();
    saveSettings();
    showToast("文字大小 " + next + "px", null, null, 650);
    return true;
  }

  function adjustSelectedStrokeByWheel(dy) {
    if (!page || !selectedId) return false;
    var o = findObject(selectedId);
    if (!o) return false;
    if (
      o.type !== "line" &&
      o.type !== "arrow" &&
      o.type !== "rect" &&
      o.type !== "ellipse" &&
      o.type !== "pen" &&
      o.type !== "highlighter"
    ) {
      return false;
    }
    wheelSizeAcc += dy;
    if (Math.abs(wheelSizeAcc) < 20) return true;
    var dir = wheelSizeAcc < 0 ? 1 : -1;
    wheelSizeAcc = 0;
    var cur = clamp(Math.round(o.width || 1), 1, 40);
    var next = clamp(cur + dir, 1, 40);
    if (next === cur) return true;
    pushHistory();
    o.width = next;
    toolWidths[o.type] = next;
    if (tool === o.type) width = next;
    syncWidthUi();
    saveSettings();
    drawAll();
    drawLive();
    markDirty();
    showToast((o.type === "arrow" ? "箭头" : o.type === "line" ? "直线" : "线条") + "粗细 " + next, null, null, 650);
    return true;
  }

  function adjustToolSizeByWheel(dy) {
    if (!page || !SIZE_WHEEL_TOOLS[tool]) return false;
    wheelSizeAcc += dy;
    if (Math.abs(wheelSizeAcc) < 20) return true;
    var dir = wheelSizeAcc < 0 ? 1 : -1;
    wheelSizeAcc = 0;
    var cur = clamp(Math.round(toolWidths[tool] || width), 1, 40);
    var next = clamp(cur + dir, 1, 40);
    if (next === cur) return true;
    toolWidths[tool] = next;
    width = next;
    syncWidthUi();
    saveSettings();
    hoverPoint = null;
    drawLive();
    showToast(toolName(tool) + "大小 " + next, null, null, 650);
    return true;
  }

  function scaleImageGroupByWheel(img, dy) {
    if (!page || !img) return false;
    if (imageWheelState.id !== img.id) {
      imageWheelState.id = img.id;
      imageWheelState.acc = 0;
      imageWheelState.at = 0;
    }
    imageWheelState.acc += dy;
    if (Math.abs(imageWheelState.acc) < 20) return true;
    var dir = imageWheelState.acc < 0 ? 1 : -1;
    imageWheelState.acc = 0;
    var group = groupObjects(img);
    if (!group.length) return true;
    var gb = groupBounds(group);
    if (gb.w < 1 || gb.h < 1) return true;
    var minS = Math.max(30 / gb.w, 30 / gb.h, 0.1);
    var maxS = Math.max(minS, boardWidth() / Math.max(1, gb.w));
    var s = clamp(dir > 0 ? 1.05 : 0.95, minS, maxS);
    if (Math.abs(s - 1) < 0.001) return true;
    var now = Date.now();
    if (now - imageWheelState.at > 700) pushHistory();
    imageWheelState.at = now;
    var cx = gb.x + gb.w / 2;
    var cy = gb.y + gb.h / 2;
    var idxs = [];
    var scaled = [];
    for (var i = 0; i < group.length; i++) {
      idxs.push(objectIndex(group[i].id));
      scaled.push(scaleObjectAbout(group[i], cx, cy, s, s));
    }
    for (var j = 0; j < scaled.length; j++) {
      if (idxs[j] >= 0) page.objects[idxs[j]] = scaled[j];
    }
    var nb = groupBounds(scaled);
    var dx = 0;
    var dy2 = 0;
    if (nb.x < 0) dx = -nb.x;
    else if (nb.x + nb.w > boardWidth()) dx = boardWidth() - nb.x - nb.w;
    if (nb.y < 0) dy2 = -nb.y;
    if (dx || dy2) {
      for (var k = 0; k < scaled.length; k++) {
        var moved = translateObject(scaled[k], dx, dy2);
        var mi = objectIndex(scaled[k].id);
        if (mi >= 0) page.objects[mi] = moved;
      }
    }
    drawAll();
    drawLive();
    markDirty();
    showToast("图片缩放 " + Math.round(s * 100) + "%", null, null, 450);
    return true;
  }

  function onWheel(e) {
    if (!isOpen || !page) return;
    e.preventDefault();
    if (el.confirm && !el.confirm.hidden) return;
    // 固定 100%：选中画笔类工具后，滚轮调大小；Alt / Shift 仍可平移
    var dx = e.deltaX;
    var dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }
    if (
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      dy &&
      textState
    ) {
      adjustTextSizeByWheel(dy);
      return;
    }
    if (
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      dy &&
      adjustSelectedStrokeByWheel(dy)
    ) {
      return;
    }
    if (
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      dy &&
      tool === "text"
    ) {
      adjustTextSizeByWheel(dy);
      return;
    }
    if (e.shiftKey) {
      var t = dx;
      dx = dy;
      dy = t;
    }
    if (
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      SIZE_WHEEL_TOOLS[tool] &&
      dy
    ) {
      adjustToolSizeByWheel(dy);
      return;
    }
    page.cam.x -= dx;
    page.cam.y -= dy;
    clampCamera();
    hoverPoint = null;
    drawAll();
    drawLive();
    markDirty();
  }

  /* ------------------------------ 键盘操作 ------------------------------ */

  function isTextInput(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      t.isContentEditable
    );
  }

  function anyPopoverOpen() {
    return (
      (el.fileMenu && !el.fileMenu.hidden) ||
      (el.sizeMenu && !el.sizeMenu.hidden)
    );
  }

  function deleteSelected() {
    var list = selectedObjectList();
    if (!list.length) return;
    var idxs = [];
    for (var i = 0; i < list.length; i++) {
      var idx = objectIndex(list[i].id);
      if (idx >= 0) idxs.push(idx);
    }
    if (!idxs.length) return;
    pushHistory();
    idxs.sort(function (a, b) {
      return b - a;
    });
    for (var j = 0; j < idxs.length; j++) page.objects.splice(idxs[j], 1);
    selectedId = null;
    clearLasso(false);
    if (lastTextId && list.some(function (o) { return o.id === lastTextId; })) {
      lastTextId = null;
    }
    drawAll();
    drawLive();
    markDirty();
  }

  function duplicateSelected() {
    var list = selectedObjectList();
    if (!list.length) return;
    var wasLasso = lassoIds.length > 0;
    pushHistory();
    var idMap = {};
    var copies = list.map(function (o) {
      var c = translateObject(o, 24, 24);
      idMap[o.id] = c.id = uid();
      return c;
    });
    for (var i = 0; i < copies.length; i++) {
      var oldParent = list[i].parentId;
      if (oldParent) {
        copies[i].parentId = idMap[oldParent] || oldParent;
      }
    }
    for (var j = 0; j < copies.length; j++) page.objects.push(copies[j]);
    if (wasLasso) {
      selectedId = null;
      lassoIds = copies.map(function (o) {
        return o.id;
      });
    } else {
      selectedId = copies[0].id;
      if (copies[0].type === "text") lastTextId = copies[0].id;
    }
    drawAll();
    drawLive();
    markDirty();
  }

  function closeImageMenu() {
    if (el.imageMenu) el.imageMenu.hidden = true;
    imageMenuAt = null;
  }

  function openImageMenu(x, y, image) {
    var menu = el.imageMenu;
    if (!menu) return;
    var copy = menu.querySelector('[data-image-act="copy"]');
    var paste = menu.querySelector('[data-image-act="paste"]');
    var del = menu.querySelector('[data-image-act="delete"]');
    if (copy) copy.hidden = !image;
    if (del) del.hidden = !image;
    if (paste) paste.hidden = !!image || !imageClipboard;
    if (!image && !imageClipboard) return;
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
  }

  function copyImageObject(image) {
    if (!image || image.type !== "image") return;
    imageClipboard = {
      rootId: image.id,
      objects: [cloneObject(image)]
    };
    showToast("已复制图片，在目标位置右键选择「粘贴图片」");
  }

  function pasteImageAt(p) {
    if (!imageClipboard || !imageClipboard.objects.length || !p) return;
    var source = imageClipboard.objects.map(cloneObject);
    var b = groupBounds(source);
    var W = boardWidth();
    var x = clamp(p.x - b.w / 2, 0, Math.max(0, W - b.w));
    var y = Math.max(0, p.y - b.h / 2);
    var dx = x - b.x;
    var dy = y - b.y;
    var idMap = {};
    source.forEach(function (o) { idMap[o.id] = uid(); });
    var copies = source.map(function (o) {
      var c = translateObject(o, dx, dy);
      c.id = idMap[o.id];
      if (c.parentId) c.parentId = idMap[c.parentId] || c.parentId;
      return c;
    });
    pushHistory();
    for (var i = 0; i < copies.length; i++) page.objects.push(copies[i]);
    selectedId = idMap[imageClipboard.rootId] || copies[0].id;
    lassoIds = [];
    setTool("select");
    drawAll();
    drawLive();
    markDirty();
    showToast("图片已粘贴");
    imageClipboard = null;
  }

  function nudgeSelected(dx, dy) {
    var list = selectedObjectList();
    if (!list.length) return;
    var b = groupBounds(list);
    var W = boardWidth();
    if (b.w <= W) {
      if (b.x + dx < 0) dx = -b.x;
      else if (b.x + b.w + dx > W) dx = W - b.x - b.w;
    } else {
      dx = -b.x;
    }
    if (b.y + dy < 0) dy = -b.y;
    if (!dx && !dy) return;
    pushHistory();
    for (var i = 0; i < list.length; i++) {
      var idx = objectIndex(list[i].id);
      if (idx >= 0) page.objects[idx] = translateObject(list[i], dx, dy);
    }
    drawAll();
    drawLive();
    markDirty();
  }

  function toggleHelp(force) {
    if (!el.help) return;
    var open = typeof force === "boolean" ? force : el.help.hidden;
    if (open) {
      closePopovers();
      el.help.hidden = false;
      try {
        el.helpClose.focus();
      } catch (err) {}
      drawLive();
    } else {
      el.help.hidden = true;
      try {
        base.focus({ preventScroll: true });
      } catch (err) {}
    }
  }

  function setFocusMode(on) {
    root.classList.toggle("is-focus", !!on);
    if (el.unfocus) el.unfocus.hidden = !on;
    if (el.focusBtn) el.focusBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (!on) {
      try {
        base.focus({ preventScroll: true });
      } catch (err) {}
    }
  }

  function trapTab(e) {
    var nodes = root.querySelectorAll(
      'button:not([disabled]):not([hidden]), [href], input:not([type="hidden"]):not([hidden]), textarea:not([hidden]), [tabindex]:not([tabindex="-1"])'
    );
    var list = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getClientRects().length) list.push(nodes[i]);
    }
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === base)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeyDown(e) {
    if (!isOpen) return;

    // Ctrl+S 随时都能存：即使正在改文字 / 正在重命名，也先落盘再提示
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      e.stopPropagation();
      if (titleEditing) finishRename(true);
      if (textState) commitText();
      saveNow();
      showToast("已保存到本浏览器");
      return;
    }

    if (e.key === "Tab") {
      trapTab(e);
      return;
    }

    if (e.target === el.titleInput) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finishRename(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finishRename(false);
      } else {
        e.stopPropagation();
      }
      return;
    }

    if (e.target === el.textEdit) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelText();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        commitText();
      } else {
        e.stopPropagation();
      }
      return;
    }

    if (confirmState) {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        settleConfirm(false);
      }
      return;
    }

    if (el.help && !el.help.hidden) {
      e.stopPropagation();
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        toggleHelp(false);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (placingGap) {
        cancelGapPlacement();
        hideToast();
      } else if (anyPopoverOpen()) {
        closePopovers();
      } else if (textState) {
        cancelText();
      } else if (lassoIds.length) {
        selectedId = null;
        clearLasso(true);
      } else if (selectedId) {
        selectedId = null;
        drawLive();
      } else if (root.classList.contains("is-focus")) {
        setFocusMode(false);
      } else {
        closeBoard();
      }
      return;
    }

    if (isTextInput(e.target)) return;

    var tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    var onButton = tag === "button" || tag === "a";
    var ctrl = e.ctrlKey || e.metaKey;
    var handled = false;

    if (ctrl) {
      var lk = e.key.toLowerCase();
      if (lk === "z") {
        if (e.shiftKey) redo();
        else undo();
        handled = true;
      } else if (lk === "y") {
        redo();
        handled = true;
      } else if (lk === "d") {
        duplicateSelected();
        handled = true;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.stopPropagation();
      return;
    }

    var key = e.key;
    var low = key.toLowerCase();

    if (key === " " || key === "Spacebar") {
      if (onButton) return;
      e.preventDefault();
      e.stopPropagation();
      setSpaceMode(true);
      return;
    }

    if (low === "arrowleft" || low === "arrowright" || low === "arrowup" || low === "arrowdown") {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedId && !lassoIds.length) return;
      var step = e.shiftKey ? 10 : 1;
      nudgeSelected(
        low === "arrowleft" ? -step : low === "arrowright" ? step : 0,
        low === "arrowup" ? -step : low === "arrowdown" ? step : 0
      );
      return;
    }

    if (low === "delete" || low === "backspace") {
      e.preventDefault();
      e.stopPropagation();
      deleteSelected();
      return;
    }

    if (low === "v") {
      setTool("select");
      handled = true;
    } else if (low === "c") {
      setTool("lasso");
      handled = true;
    } else if (low === "p") {
      setTool("pen");
      handled = true;
    } else if (low === "h") {
      setTool("highlighter");
      handled = true;
    } else if (low === "e") {
      setTool("eraser");
      handled = true;
    } else if (low === "l") {
      setTool("line");
      handled = true;
    } else if (low === "a") {
      setTool("arrow");
      handled = true;
    } else if (low === "r") {
      setTool("rect");
      handled = true;
    } else if (low === "o") {
      setTool("ellipse");
      handled = true;
    } else if (low === "t") {
      setTool("text");
      handled = true;
    } else if (low === "k") {
      setTool("laser");
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (key.length === 1) {
      e.stopPropagation();
    }
  }

  function onKeyUp(e) {
    if (!isOpen) return;
    if (e.key === " " || e.key === "Spacebar") {
      setSpaceMode(false);
    }
  }

  /* ------------------------------ 菜单 / 弹层 ------------------------------ */

  function closePopovers() {
    var pairs = [
      [el.fileMenu, el.fileBtn],
      [el.colorMenu, el.colorBtn]
    ];
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][0]) pairs[i][0].hidden = true;
      if (pairs[i][1]) pairs[i][1].setAttribute("aria-expanded", "false");
    }
    closeSizeMenu();
    if (el.imageMenu) el.imageMenu.hidden = true;
  }

  function togglePopover(menu, btn) {
    if (!menu || !btn) return;
    var willOpen = menu.hidden;
    closePopovers();
    if (!willOpen) return;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  function closeSizeMenu() {
    if (el.sizeMenu) el.sizeMenu.hidden = true;
    sizeMenuTool = null;
    sizeMenuTextFired = false;
  }

  function currentTextObject() {
    if (textState) return textState.obj;
    var sel = findObject(selectedId);
    if (sel && sel.type === "text") return sel;
    var last = findObject(lastTextId);
    if (last && last.type === "text") return last;
    return null;
  }

  function openSizeMenu(toolId, btn) {
    if (!el.sizeMenu || DEFAULT_TOOL_WIDTHS[toolId] == null) return;
    closePopovers();
    sizeMenuTool = toolId;
    sizeMenuTextFired = false;
    var name = toolId;
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i].id === toolId) name = TOOLS[i].name;
    }
    var val;
    if (toolId === "text") {
      var target = currentTextObject();
      val = Math.round(target ? target.fontSize : textFontSize());
      el.sizeName.textContent = "文字大小";
      el.sizeRange.min = 14;
      el.sizeRange.max = 160;
      el.sizeVal.min = 14;
      el.sizeVal.max = 160;
    } else {
      val = toolWidths[toolId] || width;
      el.sizeName.textContent = name + "大小";
      el.sizeRange.min = 1;
      el.sizeRange.max = 40;
      el.sizeVal.min = 1;
      el.sizeVal.max = 40;
    }
    el.sizeVal.value = val;
    el.sizeRange.value = val;
    el.sizeMenu.hidden = false;
    var rr = root.getBoundingClientRect();
    var br = btn.getBoundingClientRect();
    var mr = el.sizeMenu.getBoundingClientRect();
    var left = br.right - rr.left + 8;
    var top = br.top - rr.top + br.height / 2 - mr.height / 2;
    if (br.top > rr.height * 0.68) {
      var opt = document.querySelector(".cwb-opts");
      var optRect = opt ? opt.getBoundingClientRect() : null;
      top = (optRect ? optRect.top : br.top) - rr.top - mr.height - 8;
    }
    if (left + mr.width > rr.width - 8) {
      left = br.left - rr.left - mr.width - 8;
    }
    left = clamp(left, 8, Math.max(8, rr.width - mr.width - 8));
    top = clamp(top, 8, Math.max(8, rr.height - mr.height - 8));
    el.sizeMenu.style.left = left + "px";
    el.sizeMenu.style.top = top + "px";
    try {
      el.sizeRange.focus({ preventScroll: true });
    } catch (err) {}
  }

  function applySizeFromMenu() {
    if (!sizeMenuTool) return;
    var isText = sizeMenuTool === "text";
    var val = clamp(
      Math.round(Number(el.sizeRange.value) || (isText ? 30 : 1)),
      isText ? 14 : 1,
      isText ? 160 : 40
    );
    el.sizeVal.value = val;
    if (isText) {
      // 文字工具右侧的“文字大小”直接按 px 显示和修改
      textSizeCustomized = true;
      toolWidths.text = clamp((val - 14) / 4, 0, 40);
      if (tool === "text") width = toolWidths.text;
      var target = currentTextObject();
      if (target) {
        if (textState) {
          textState.obj.fontSize = val;
          fitEditingTextBox(textState.obj);
          applyTextStyle();
          drawAll();
          drawLive();
        } else if (Math.round(target.fontSize) !== val) {
          if (!sizeMenuTextFired) {
            pushHistory();
            sizeMenuTextFired = true;
          }
          var idx = objectIndex(target.id);
          if (idx >= 0) {
            var c = cloneObject(target);
            c.fontSize = val;
            c.manual = true;
            c.lines = [];
            relayoutTextBox(c);
            page.objects[idx] = c;
            lastTextId = c.id;
            if (selectedId === target.id) selectedId = c.id;
            drawAll();
            drawLive();
            markDirty();
          }
        }
      }
      syncWidthUi();
      saveSettings();
      return;
    }
    toolWidths[sizeMenuTool] = val;
    if (tool === sizeMenuTool) {
      width = val;
      syncWidthUi();
      hoverPoint = null;
      drawLive();
    }
    saveSettings();
  }

  /* ------------------------------ 打开 / 关闭 ------------------------------ */

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    var restored = loadDoc();
    doc = restored || newDoc();
    page = activePage();
    if (!page) {
      page = newPage(timePageName(), "white");
      doc.pages = [page];
      doc.activeId = page.id;
    }
    if (!page.cam) page.cam = { x: 0, y: 0, scale: 1 };
    selectedId = null;
    lastTextId = null;
    applySettings(doc.settings);
    if (restored && doc._migrated) markDirty();
    if (restored && doc.updatedAt) {
      setSaved("saved", "已保存 · " + formatClock(doc.updatedAt));
    } else {
      setSaved("saved", "已保存");
      saveDoc();
    }
  }

  function openBoard() {
    if (isOpen) return;
    window.clearTimeout(closeTimer);
    closeTimer = 0;
    lastFocus = document.activeElement;
    ensureLoaded();
    isOpen = true;
    setParentNavHidden(true);
    document.documentElement.classList.add("cwb-open");
    setRevealOrigin();
    root.hidden = false;
    root.classList.remove("is-closing");
    root.classList.remove("is-shown");
    // 先让 0 半径的裁剪生效，再加 is-shown 触发圆形展开
    void root.offsetWidth;
    root.classList.add("is-shown");
    selectedId = null;
    lassoIds = [];
    draft = null;
    action = null;
    pointers = {};
    pinchState = null;
    laser.points = [];
    hoverPoint = null;
    setFocusMode(false);
    closePopovers();
    toggleHelp(false);
    settleConfirm(false);
    renderChrome();
    resize();
    drawAll();
    drawLive();
    try {
      base.focus({ preventScroll: true });
    } catch (err) {}
    window.requestAnimationFrame(function () {
      if (!isOpen) return;
      resize();
      drawAll();
      drawLive();
    });
  }

  function setRevealOrigin() {
    if (!el.open) return;
    var r = el.open.getBoundingClientRect();
    if (!r.width && !r.height) return;
    root.style.setProperty("--cwb-ox", r.left + r.width / 2 + "px");
    root.style.setProperty("--cwb-oy", r.top + r.height / 2 + "px");
  }

  function finishClose() {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
    if (isOpen) return;
    root.hidden = true;
    root.classList.remove("is-shown");
    root.classList.remove("is-closing");
    setParentNavHidden(false);
    document.documentElement.classList.remove("cwb-open");
    if (lastFocus && lastFocus.focus) {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (err) {
        try {
          lastFocus.focus();
        } catch (err2) {}
      }
    }
  }

  function closeBoard() {
    if (!isOpen) return;
    commitText();
    cancelGesture();
    closePopovers();
    toggleHelp(false);
    settleConfirm(false);
    setFocusMode(false);
    hideToast();
    saveNow();
    isOpen = false;
    setParentNavHidden(false);
    document.documentElement.classList.remove("cwb-open");
    root.classList.remove("is-shown");
    root.classList.add("is-closing");
    var reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {}
    closeTimer = window.setTimeout(finishClose, reduce ? 0 : 520);
  }

  function onResize() {
    if (!isOpen) return;
    window.cancelAnimationFrame(resizeRaf);
    resizeRaf = window.requestAnimationFrame(function () {
      if (!isOpen) return;
      setRevealOrigin();
      resize();
      drawAll();
      drawLive();
    });
  }

  /* 读书会嵌在首页 iframe 里时，把父页面的站内顶栏也收起来，白板才是真整屏。
     同源才做得到；单独打开 /chan/ 或跨域嵌入时静默跳过。 */
  function setParentNavHidden(hidden) {
    try {
      var p = window.parent;
      if (!p || p === window) return;
      var d = p.document;
      if (!d || !d.documentElement) return;
      d.documentElement.classList.toggle("chan-wb-open", !!hidden);
    } catch (err) {}
  }

  /* ------------------------------- 事件绑定 ------------------------------- */

  function bind() {
    el.open.addEventListener("click", openBoard);
    el.close.addEventListener("click", closeBoard);

    el.fileBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      togglePopover(el.fileMenu, el.fileBtn);
    });
    if (el.colorBtn) {
      el.colorBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePopover(el.colorMenu, el.colorBtn);
      });
    }
    el.fileMenu.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-cwb-act]") : null;
      if (!b) return;
      var act = b.dataset.cwbAct;
      closePopovers();
      if (act === "export-png") exportPng();
      else if (act === "export-json") exportJson();
      else if (act === "import") {
        if (el.importInput) {
          el.importInput.value = "";
          el.importInput.click();
        }
      } else if (act === "clear-page") clearPage();
    });

    if (el.imageMenu) {
      el.imageMenu.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-image-act]") : null;
        if (!b) return;
        var act = b.dataset.imageAct;
        if (act === "copy") {
          copyImageObject(findObject(selectedId));
          closeImageMenu();
        } else if (act === "paste") {
          var at = imageMenuAt;
          closeImageMenu();
          pasteImageAt(at);
        } else if (act === "delete") {
          closeImageMenu();
          deleteSelected();
        }
      });
    }

    el.title.addEventListener("click", startRename);
    el.titleInput.addEventListener("blur", function () {
      if (titleEditing) finishRename(true);
    });

    el.fillBtn.addEventListener("click", function () {
      setFill(!fillShape);
    });
    if (el.bgToggle) {
      el.bgToggle.addEventListener("click", function () {
        if (!page) return;
        setTheme(page.bg === "black" ? "white" : "black");
      });
    }
    if (el.extendBtn) {
      el.extendBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        startGapPlacement();
      });
    }
    if (el.toTop) {
      el.toTop.addEventListener("click", function (e) {
        e.stopPropagation();
        scrollToTop();
      });
    }
    if (el.toBottom) {
      el.toBottom.addEventListener("click", function (e) {
        e.stopPropagation();
        scrollToBottom();
      });
    }

    el.confirmOk.addEventListener("click", function () {
      settleConfirm(true);
    });
    el.confirmCancel.addEventListener("click", function () {
      settleConfirm(false);
    });

    el.importInput.addEventListener("change", function () {
      var f = el.importInput.files && el.importInput.files[0];
      el.importInput.value = "";
      if (f) importFile(f);
    });
    el.imageInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(el.imageInput.files || []);
      el.imageInput.value = "";
      if (files.length) insertImages(files);
    });

    el.textEdit.addEventListener("input", function () {
      if (!textState) return;
      textState.obj.text = el.textEdit.value.replace(/\r\n/g, "\n");
      fitEditingTextBox(textState.obj);
      positionText();
    });
    el.textEdit.addEventListener("paste", function () {
      window.setTimeout(function () {
        if (!textState) return;
        var t = textState.obj;
        t.text = el.textEdit.value.replace(/\r\n/g, "\n");
        fitEditingTextBox(t);
        positionText();
      }, 0);
    });
    el.textEdit.addEventListener(
      "wheel",
      function (e) {
        if (!textState) return;
        e.preventDefault();
        e.stopPropagation();
        var dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        adjustTextSizeByWheel(dy);
      },
      { passive: false }
    );
    el.textEdit.addEventListener("blur", function () {
      if (textState) commitText();
    });

    live.addEventListener("pointerdown", onPointerDown);
    live.addEventListener("pointermove", onPointerMove);
    live.addEventListener("pointerup", onPointerUp);
    live.addEventListener("pointercancel", onPointerCancel);
    live.addEventListener("pointerleave", function () {
      if (!action && hoverPoint) {
        hoverPoint = null;
        drawLive();
      }
    });
    live.addEventListener("dblclick", function (e) {
      if (!isOpen || tool !== "select") return;
      var p = worldPoint(e);
      var o = hitTest(p.x, p.y, false, true);
      if (o && o.type === "text") {
        e.preventDefault();
        beginText(o.x, o.y, o);
      }
    });
    live.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      if (placingGap) {
        cancelGapPlacement();
        hideToast();
        return;
      }
      var p = worldPoint(e);
      var img = imageAt(p.x, p.y);
      closePopovers();
      if (img) {
        selectedId = img.id;
        lassoIds = [];
        setTool("select");
        drawAll();
        drawLive();
        imageMenuAt = { x: p.x, y: p.y };
        openImageMenu(e.clientX, e.clientY, img);
        return;
      }
      if (imageClipboard) {
        imageMenuAt = { x: p.x, y: p.y };
        openImageMenu(e.clientX, e.clientY, null);
        return;
      }
      deactivateActiveTool();
    });
    live.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("dragover", function (e) {
      if (!isOpen) return;
      e.preventDefault();
    });
    stage.addEventListener("drop", function (e) {
      if (!isOpen) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) insertImages(e.dataTransfer.files);
    });

    if (el.sizeRange) {
      el.sizeRange.addEventListener("input", applySizeFromMenu);
    }
    if (el.sizeVal) {
      el.sizeVal.addEventListener("change", function () {
        var n = Number(el.sizeVal.value);
        if (!isFinite(n) || n <= 0) return;
        el.sizeRange.value = n;
        applySizeFromMenu();
      });
    }

    document.addEventListener("click", function (e) {
      if (!isOpen) return;
      var t = e.target;
      if (
        t &&
        t.closest &&
        (t.closest(".cwb-pop") ||
          t.closest(".cwb-menu-wrap") ||
          t.closest("#cwbSizeMenu"))
      ) {
        return;
      }
      closePopovers();
    });

    document.addEventListener("paste", function (e) {
      if (!isOpen || !e.clipboardData) return;
      var items = e.clipboardData.items || [];
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        insertImages(files);
        return;
      }
      var text = e.clipboardData.getData("text/plain");
      if (text && text.trim() && !isTextInput(document.activeElement)) {
        e.preventDefault();
        insertTextContent(text);
      }
    });

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", function () {
      setSpaceMode(false);
      if (action && action.kind === "pinch") cancelGesture();
    });
    window.addEventListener("pagehide", function () {
      if (loaded) saveNow();
      if (isOpen) setParentNavHidden(false);
    });
    window.addEventListener("pageshow", function () {
      if (!isOpen) setParentNavHidden(false);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && loaded) saveNow();
    });
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(onResize).observe(stage);
      } catch (err) {}
    }

    // 图片输入支持多选
    if (el.imageInput) el.imageInput.multiple = true;

    // 画布可以接收键盘焦点（Tab / 空格快捷键都靠它）
    base.tabIndex = 0;
    live.tabIndex = -1;
  }

  /* -------------------------------- 启动 -------------------------------- */

  buildTools();
  buildColors();
  buildWidths();
  buildBgSwatches();
  bind();
  setParentNavHidden(false);

  // 供调试和自动化检查用；不参与白板其它逻辑。
  try {
    window.ChanWhiteboard = {
      open: openBoard,
      close: closeBoard,
      isOpen: function () {
        return isOpen;
      },
      getState: function () {
        return {
          open: isOpen,
          tool: tool,
          color: color,
          width: width,
          selectedId: selectedId,
          selectedType: selectedId && findObject(selectedId) ? findObject(selectedId).type : "",
          lassoIds: lassoIds.slice(),
          lassoCount: lassoIds.length,
          action: action ? action.kind : "",
          actionPoints: action && action.points ? action.points.length : 0,
          page: page
            ? {
                id: page.id,
                name: page.name,
                bg: page.bg,
                width: page.width,
                objects: page.objects.length,
                cam: {
                  x: Math.round(page.cam.x),
                  y: Math.round(page.cam.y),
                  scale: Math.round(page.cam.scale * 1000) / 1000
                }
              }
            : null,
          pages: doc ? doc.pages.length : 0
        };
      }
    };
  } catch (err) {}
})();

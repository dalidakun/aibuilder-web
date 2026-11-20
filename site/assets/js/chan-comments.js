/* 缠论读书会 · 每课提问
   - 每篇文章末尾一块「提问」区，任何用户都能提问、回复别人的提问；
   - 提问可以附图片：图片先在本地压到长边 900px / JPEG 低质量再上传，
     列表里只显示小缩略图，点开看压缩后的原图，控制流量与存储成本；
   - randeng 等管理员可置顶 / 删除任意提问，作者可删除自己的提问；
   - 提问按 lessonNo 归属，课与课互不混淆；
   - 身份与正文注释共用 localStorage 里的 clientId + secret，
     管理员由云函数 chanAdmins 里的 clientId + clientHash 判定。 */
(function () {
  "use strict";

  var reader = document.getElementById("chanReader");
  var cfg = window.CHAN_CFG || {};
  if (!reader || !cfg.api || !cfg.key) return;

  /* ------------------------------------------------------------ 本地身份 */

  var LS_ID = "chan:anno:id";
  var LS_SECRET = "chan:anno:secret";
  var LS_NAME = "chan:anno:name";
  var TRADE_USER_KEY = "huideng.trade.user";

  function readLS(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeLS(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {}
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

  var clientId = readLS(LS_ID);
  if (!clientId) {
    clientId = randomHex(12);
    writeLS(LS_ID, clientId);
  }
  var secret = readLS(LS_SECRET);
  if (!secret) {
    secret = randomHex(24);
    writeLS(LS_SECRET, secret);
  }

  function savedName() {
    return readLS(LS_NAME) || readLS(TRADE_USER_KEY) || "";
  }

  /* -------------------------------------------------------------- 状态 */

  var lessonNo = 0;
  var state = null; // { no, comments: [], total, admin, profiles, error }
  var cache = {}; // no -> { comments, total, admin, profiles, at }
  var loadSeq = 0;
  var replyOpen = null;
  var toastEl = null;
  var toastTimer = 0;
  var CACHE_TTL = 60 * 1000;
  // 附图：最多 3 张。优先保清晰度（长边 1600px），再按体积降质量。
  var MAX_IMAGES = 3;
  var MAX_EDGE = 1600;
  var MAX_IMAGE_CHARS = 220000;
  var MAX_TOTAL_CHARS = 660000;
  var myAvatar = "";
  var avatarTried = false;
  var avatarSaved = false;

  /* -------------------------------------------------------------- 工具 */

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
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

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
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

  // 本地压缩：长边 1600px、白底；先保分辨率，再逐档降 JPEG 质量。
  // 只把压好的这一份存进数据库，列表里缩成小图显示。
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//i.test(file.type || "")) {
        reject(new Error("bad_type"));
        return;
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) throw new Error("empty_image");
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          // PNG 透明底转 JPEG 会变黑，先铺白底
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          var q = 0.78;
          var data = canvas.toDataURL("image/jpeg", q);
          while (data.length > MAX_IMAGE_CHARS && q > 0.5) {
            q -= 0.05;
            data = canvas.toDataURL("image/jpeg", q);
          }
          if (data.length > MAX_IMAGE_CHARS) {
            canvas.width = Math.max(1, Math.round(cw * 0.82));
            canvas.height = Math.max(1, Math.round(ch * 0.82));
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            q = 0.62;
            data = canvas.toDataURL("image/jpeg", q);
            while (data.length > MAX_IMAGE_CHARS && q > 0.42) {
              q -= 0.05;
              data = canvas.toDataURL("image/jpeg", q);
            }
          }
          resolve(data);
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      img.src = url;
    });
  }

  function activeSection() {
    return reader.querySelector(".chan-lesson.is-on");
  }

  function commentsBox(no) {
    var sec = no
      ? document.querySelector('.chan-lesson[data-no="' + no + '"]')
      : activeSection();
    return sec ? sec.querySelector(".chan-comments") : null;
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
        "x-device-id": "web-chan-comments",
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
    if (code === "rate_limited") return "发得太频繁了，歇一会儿再试";
    if (code === "empty_comment") return "提问不能为空";
    if (code === "parent_deleted") return "这条提问已经被删除了";
    if (code === "forbidden") return "没有权限执行这个操作";
    if (code === "bad_image") return "图片格式不支持，换张图试试";
    if (code === "too_many_images") return "最多只能放 3 张图片";
    if (code === "image_too_large") return "图片太大了，换小一点的";
    if (code === "bad_request") return "内容有点问题，请检查后再试";
    return "网络不给力，请稍后重试";
  }

  /* -------------------------------------------------------------- 加载 */

  function load(no, force) {
    if (!no) return;
    var box = commentsBox(no);
    if (!box) return;
    var cached = cache[no];
    if (!force && cached && Date.now() - cached.at < CACHE_TTL) {
      state = {
        no: no,
        comments: cached.comments,
        total: cached.total,
        admin: cached.admin,
        profiles: cached.profiles || {},
        error: false,
      };
      render();
      return;
    }
    var seq = ++loadSeq;
    state = { no: no, comments: null, total: 0, admin: false, profiles: {}, error: false };
    render();
    api("getChanComments", {
      lessonNo: no,
      clientId: clientId,
      clientSecret: secret,
    })
      .then(function (j) {
        if (seq !== loadSeq || no !== lessonNo) return;
        var comments = (j && j.comments) || [];
        state = {
          no: no,
          comments: comments,
          total: Number(j.total) || 0,
          admin: !!j.admin,
          profiles: (j && j.profiles) || {},
          error: false,
        };
        cache[no] = {
          comments: comments,
          total: state.total,
          admin: state.admin,
          profiles: state.profiles,
          at: Date.now(),
        };
        render();
        if (state.admin) startAdminInbox();
        else stopAdminInbox();
      })
      .catch(function () {
        if (seq !== loadSeq || no !== lessonNo) return;
        state = { no: no, comments: null, total: 0, admin: false, profiles: {}, error: true };
        render();
      });
  }

  function reload() {
    delete cache[lessonNo];
    load(lessonNo, true);
  }

  function avatarFor(c) {
    var fromState = state && state.profiles ? state.profiles[c.clientId] : "";
    if (fromState) return fromState;
    if (c.clientId && c.clientId === clientId && myAvatar) return myAvatar;
    return "";
  }

  function avatarNode(c, who) {
    var src = avatarFor(c);
    if (src) {
      var img = document.createElement("img");
      img.className = "chan-comment__avatar chan-comment__avatar--img";
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      return img;
    }
    return el(
      "span",
      "chan-comment__avatar",
      String(who || "匿").trim().charAt(0) || "匿"
    );
  }

  // 头像取自己账号里上传过的头像（交易/个人资料共用 tradeAvatarGet），
  // 存到 chanProfiles（按 clientId），这样所有用户都能看到；没有就保持首字默认头像。
  function applyMyAvatar() {
    if (!myAvatar) return;
    if (state && state.profiles) state.profiles[clientId] = myAvatar;
    if (cache[lessonNo]) {
      if (!cache[lessonNo].profiles) cache[lessonNo].profiles = {};
      cache[lessonNo].profiles[clientId] = myAvatar;
    }
    var nodes = document.querySelectorAll(
      '.chan-comment[data-client="' + clientId + '"] > .chan-comment__avatar'
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var old = nodes[i];
      var img = document.createElement("img");
      img.className = "chan-comment__avatar chan-comment__avatar--img";
      img.src = myAvatar;
      img.alt = "";
      img.loading = "lazy";
      old.parentNode.replaceChild(img, old);
    }
    if (adminDock) renderAdminAvatar();
  }

  function fetchMyAvatar() {
    if (avatarTried) return;
    avatarTried = true;
    var token = readLS("huideng.trade.token");
    if (!token) return;
    api("tradeAvatarGet", { token: token })
      .then(function (j) {
        var av = j && j.avatar ? String(j.avatar) : "";
        if (!av) return;
        myAvatar = av;
        applyMyAvatar();
        if (!avatarSaved) {
          avatarSaved = true;
          api("saveChanAvatar", {
            clientId: clientId,
            clientSecret: secret,
            avatar: av,
          }).catch(function () {});
        }
      })
      .catch(function () {});
  }

  /* -------------------------------------------------------------- 渲染 */

  function render() {
    var box = commentsBox(state ? state.no : lessonNo);
    if (!box || !state) return;
    box.innerHTML = "";

    var head = el("div", "chan-comments__head");
    head.appendChild(el("h2", "chan-comments__title", "提问"));
    var count = el(
      "span",
      "chan-comments__count",
      state.comments ? String(state.total) : "…"
    );
    head.appendChild(count);
    if (state.admin) {
      var badge = el("span", "chan-comments__admin", "管理员");
      badge.title = "你可以置顶或删除本课提问";
      head.appendChild(badge);
    }
    var refresh = el("button", "chan-comments__refresh", "↻");
    refresh.type = "button";
    refresh.setAttribute("aria-label", "刷新提问");
    refresh.title = "刷新提问";
    refresh.addEventListener("click", function () {
      reload();
    });
    head.appendChild(refresh);
    box.appendChild(head);

    if (state.error) {
      box.appendChild(el("p", "chan-comments__empty", "提问加载失败，点右上角 ↻ 重试。"));
      return;
    }
    if (!state.comments) {
      box.appendChild(el("p", "chan-comments__empty", "正在加载提问…"));
      return;
    }

    box.appendChild(composer());

    var list = el("div", "chan-comments__list");
    // 删掉的评论不显示；主楼删掉时，它下面的回复也不显示
    var visible = state.comments.filter(function (c) {
      return !c.deleted;
    });
    var tops = visible.filter(function (c) {
      return !c.parentId;
    });
    tops.sort(function (a, b) {
      var ap = !!a.pinned;
      var bp = !!b.pinned;
      if (bp !== ap) return bp ? 1 : -1;
      if (bp && ap) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (!tops.length) {
      list.appendChild(
        el("p", "chan-comments__empty", "还没有提问，来问一个吧。")
      );
    } else {
      tops.forEach(function (top) {
        var replies = visible
          .filter(function (c) {
            return c.parentId === top.id;
          })
          .sort(function (a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
          });
        list.appendChild(commentEl(top, replies, true));
      });
    }
    box.appendChild(list);
  }

  // 提问框和回复框共用的附图选择器：选图 -> 本地压缩 -> 缩略图可删
  function createImagePicker() {
    var pending = [];
    var busy = false;
    var node = el("span", "chan-comments__attach");
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.className = "chan-comments__file";
    input.setAttribute("aria-label", "添加图片");
    var button = el("button", "chan-comments__pick", "添加图片");
    button.type = "button";
    button.title = "最多 3 张，自动压缩";
    var hint = el("span", "chan-comments__pick-hint", "最多 3 张 · 自动压缩");
    var thumbs = el("div", "chan-comments__thumbs");
    thumbs.hidden = true;
    node.appendChild(input);
    node.appendChild(button);
    node.appendChild(hint);

    function totalChars() {
      return pending.reduce(function (n, s) {
        return n + s.length;
      }, 0);
    }

    function renderThumbs() {
      thumbs.innerHTML = "";
      thumbs.hidden = !pending.length;
      pending.forEach(function (src, i) {
        var cell = el("span", "chan-comments__thumb");
        var img = document.createElement("img");
        img.src = src;
        img.alt = "待发布图片 " + (i + 1);
        cell.appendChild(img);
        var del = el("button", "chan-comments__thumb-del", "×");
        del.type = "button";
        del.setAttribute("aria-label", "移除这张图片");
        del.addEventListener("click", function () {
          pending.splice(i, 1);
          renderThumbs();
        });
        cell.appendChild(del);
        thumbs.appendChild(cell);
      });
      button.disabled = busy || pending.length >= MAX_IMAGES;
    }

    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = "";
      if (!files.length) return;
      var room = MAX_IMAGES - pending.length;
      if (room <= 0) {
        toast("最多 3 张图片");
        return;
      }
      if (files.length > room) toast("最多 3 张，只取前 " + room + " 张");
      var chain = Promise.resolve();
      files.slice(0, room).forEach(function (file) {
        chain = chain
          .then(function () {
            return compressImage(file).then(function (src) {
              if (totalChars() + src.length > MAX_TOTAL_CHARS) {
                toast("图片总大小超了，换小一点的图");
                return;
              }
              pending.push(src);
              renderThumbs();
            });
          })
          .catch(function () {
            toast("这张图片读不出来，换一张试试");
          });
      });
    });

    button.addEventListener("click", function () {
      if (!button.disabled) input.click();
    });

    return {
      node: node,
      thumbs: thumbs,
      values: function () {
        return pending.slice();
      },
      clear: function () {
        pending = [];
        renderThumbs();
      },
      setDisabled: function (v) {
        busy = !!v;
        button.disabled = busy || pending.length >= MAX_IMAGES;
      },
    };
  }

  function composer() {
    var wrap = el("div", "chan-comments__compose");
    var ta = el("textarea");
    ta.maxLength = 1000;
    ta.placeholder = "写下你的问题…（可附图片）";
    ta.setAttribute("aria-label", "提问内容");
    wrap.appendChild(ta);

    var picker = createImagePicker();
    wrap.appendChild(picker.thumbs);

    var row = el("div", "chan-comments__compose-row");
    var btn = el("button", "chan-comments__submit", "发布提问");
    btn.type = "button";
    row.appendChild(picker.node);
    row.appendChild(btn);
    wrap.appendChild(row);

    function submit() {
      var text = String(ta.value || "").trim();
      var images = picker.values();
      if (!text && !images.length) {
        toast("写点问题或加张图片");
        ta.focus();
        return;
      }
      var who = String(savedName() || "").trim().slice(0, 20);
      btn.disabled = true;
      picker.setDisabled(true);
      btn.textContent = "发布中…";
      api(
        "createChanComment",
        {
          lessonNo: lessonNo,
          parentId: "",
          content: text,
          images: images,
          name: who,
          clientId: clientId,
          clientSecret: secret,
        },
        40000
      )
        .then(function () {
          toast("提问已发布");
          reload();
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = "发布提问";
          picker.setDisabled(false);
          toast(errorText(e));
        });
    }

    btn.addEventListener("click", submit);
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    // 当前课切走时草稿不该跟着乱跑到别的课：不缓存草稿，切课重建
    return wrap;
  }

  var viewer = null;
  var viewerImages = [];
  var viewerIndex = 0;

  function ensureViewer() {
    if (viewer) return;
    viewer = el("div", "chan-comment-viewer");
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", "查看图片");
    var img = document.createElement("img");
    img.alt = "提问图片";
    var prev = el("button", "chan-comment-viewer__nav chan-comment-viewer__nav--prev", "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", "上一张");
    var next = el("button", "chan-comment-viewer__nav chan-comment-viewer__nav--next", "›");
    next.type = "button";
    next.setAttribute("aria-label", "下一张");
    var close = el("button", "chan-comment-viewer__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    var count = el("span", "chan-comment-viewer__count");
    viewer.appendChild(img);
    viewer.appendChild(prev);
    viewer.appendChild(next);
    viewer.appendChild(close);
    viewer.appendChild(count);
    prev.addEventListener("click", function (e) {
      e.stopPropagation();
      stepGallery(-1);
    });
    next.addEventListener("click", function (e) {
      e.stopPropagation();
      stepGallery(1);
    });
    close.addEventListener("click", function (e) {
      e.stopPropagation();
      closeGallery();
    });
    viewer.addEventListener("click", function (e) {
      if (e.target === viewer) closeGallery();
    });
    // 手机上左右滑也能翻图
    var sx = 0;
    viewer.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches && e.touches.length === 1) sx = e.touches[0].clientX;
      },
      { passive: true }
    );
    viewer.addEventListener(
      "touchend",
      function (e) {
        if (!sx || !e.changedTouches || !e.changedTouches.length) {
          sx = 0;
          return;
        }
        var dx = e.changedTouches[0].clientX - sx;
        sx = 0;
        if (Math.abs(dx) > 40) stepGallery(dx > 0 ? -1 : 1);
      },
      { passive: true }
    );
    viewer.hidden = true;
    document.body.appendChild(viewer);
  }

  function renderViewer() {
    if (!viewer) return;
    var img = viewer.querySelector("img");
    var prev = viewer.querySelector(".chan-comment-viewer__nav--prev");
    var next = viewer.querySelector(".chan-comment-viewer__nav--next");
    var count = viewer.querySelector(".chan-comment-viewer__count");
    img.src = viewerImages[viewerIndex] || "";
    prev.disabled = viewerIndex <= 0;
    next.disabled = viewerIndex >= viewerImages.length - 1;
    count.textContent =
      viewerImages.length > 1 ? viewerIndex + 1 + " / " + viewerImages.length : "";
    count.hidden = viewerImages.length <= 1;
  }

  function openGallery(images, start) {
    if (!images || !images.length) return;
    ensureViewer();
    viewerImages = images.slice();
    viewerIndex = Math.min(Math.max(start | 0, 0), viewerImages.length - 1);
    renderViewer();
    viewer.hidden = false;
  }

  function stepGallery(delta) {
    if (!viewer || viewer.hidden) return;
    var i = viewerIndex + delta;
    if (i < 0 || i >= viewerImages.length) return;
    viewerIndex = i;
    renderViewer();
  }

  function closeGallery() {
    if (viewer) viewer.hidden = true;
  }

  // 看图时左右键翻图，不要再触发 chan.js 的整课翻页
  document.addEventListener(
    "keydown",
    function (e) {
      if (!viewer || viewer.hidden) return;
      if (e.key === "Escape") {
        closeGallery();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        stepGallery(e.key === "ArrowLeft" ? -1 : 1);
      }
    },
    true
  );

  function commentEl(c, replies, isTop) {
    var box = el("article", "chan-comment");
    box.setAttribute("data-id", c.id);
    if (!isTop) box.classList.add("chan-comment--reply");

    // 自己的内容用当前「我的名字」显示，别人用当时存的署名
    var isMine = !!c.mine || !!(c.clientId && c.clientId === clientId);
    var who = String((isMine ? savedName() : c.name) || "匿名读者").replace(/^@+/, "");
    box.setAttribute("data-client", c.clientId || "");
    box.appendChild(avatarNode(c, who));

    var main = el("div", "chan-comment__main");
    box.appendChild(main);

    var head = el("div", "chan-comment__head");
    head.appendChild(el("span", "chan-comment__who", who));
    if (!isTop && c.replyToName) {
      head.appendChild(
        el(
          "span",
          "chan-comment__replyto",
          "回复 " + String(c.replyToName).replace(/^@+/, "")
        )
      );
    }
    if (c.pinned) head.appendChild(el("span", "chan-comment__pin", "置顶"));
    head.appendChild(el("span", "chan-comment__time", formatTime(c.createdAt)));
    main.appendChild(head);

    if (c.content) {
      main.appendChild(el("p", "chan-comment__body", c.content));
    }

    if (c.images && c.images.length) {
      var gallery = el("div", "chan-comment__images");
      c.images.forEach(function (src, i) {
        var img = document.createElement("img");
        img.className = "chan-comment__image";
        img.src = src;
        img.alt = "图片";
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("click", function () {
          openGallery(c.images, i);
        });
        gallery.appendChild(img);
      });
      main.appendChild(gallery);
    } else if (c.imagesHidden) {
      main.appendChild(
        el("p", "chan-comment__images-note", "图片已省略（较早的提问）")
      );
    }

    var acts = el("div", "chan-comment__acts");
    var replyBtn = el("button", "", "回复");
    replyBtn.type = "button";
    replyBtn.addEventListener("click", function () {
      openReplyForm(box, c);
    });
    acts.appendChild(replyBtn);

    if (state.admin) {
      var delBtn = el("button", "", "删除");
      delBtn.type = "button";
      delBtn.addEventListener("click", function () {
        removeComment(c.id);
      });
      acts.appendChild(delBtn);
    }
    if (state.admin && isTop) {
      var pinBtn = el("button", "", c.pinned ? "取消置顶" : "置顶");
      pinBtn.type = "button";
      pinBtn.addEventListener("click", function () {
        pinComment(c.id, !c.pinned);
      });
      acts.appendChild(pinBtn);
    }
    if (acts.children.length) main.appendChild(acts);

    if (isTop && replies.length) {
      var wrap = el("div", "chan-comment__replies");
      replies.forEach(function (r) {
        wrap.appendChild(commentEl(r, [], false));
      });
      main.appendChild(wrap);
    }
    return box;
  }

  function openReplyForm(parentBox, comment) {
    if (replyOpen) {
      replyOpen.remove();
      replyOpen = null;
    }
    var form = el("div", "chan-comment__reply-form");
    var ta = el("textarea");
    ta.maxLength = 1000;
    ta.placeholder = "回复 " + String(comment.name || "匿名读者").replace(/^@+/, "") + "…";
    ta.setAttribute("aria-label", "回复内容");
    form.appendChild(ta);

    var picker = createImagePicker();
    form.appendChild(picker.thumbs);

    var row = el("div", "chan-comments__compose-row");
    var cancel = el("button", "chan-comments__cancel", "取消");
    cancel.type = "button";
    var send = el("button", "chan-comments__submit", "回复");
    send.type = "button";
    row.appendChild(picker.node);
    row.appendChild(cancel);
    row.appendChild(send);
    form.appendChild(row);

    var host = parentBox.querySelector(".chan-comment__main") || parentBox;
    var repliesBox = host.querySelector(".chan-comment__replies");
    if (repliesBox) host.insertBefore(form, repliesBox);
    else host.appendChild(form);
    replyOpen = form;
    ta.focus();

    cancel.addEventListener("click", function () {
      form.remove();
      if (replyOpen === form) replyOpen = null;
    });

    function submit() {
      var text = String(ta.value || "").trim();
      var images = picker.values();
      if (!text && !images.length) {
        toast("写点回复或加张图片");
        ta.focus();
        return;
      }
      send.disabled = true;
      picker.setDisabled(true);
      send.textContent = "回复中…";
      api(
        "createChanComment",
        {
          lessonNo: lessonNo,
          parentId: comment.id,
          content: text,
          images: images,
          name: savedName(),
          clientId: clientId,
          clientSecret: secret,
        },
        40000
      )
        .then(function () {
          toast("回复已发布");
          reload();
        })
        .catch(function (e) {
          send.disabled = false;
          picker.setDisabled(false);
          send.textContent = "回复";
          toast(errorText(e));
        });
    }

    send.addEventListener("click", submit);
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
  }

  function removeComment(id) {
    if (!window.confirm("删除这条提问？")) return;
    api("deleteChanComment", {
      id: id,
      clientId: clientId,
      clientSecret: secret,
    })
      .then(function () {
        toast("操作成功");
        reload();
      })
      .catch(function (e) {
        toast(errorText(e));
      });
  }

  function pinComment(id, pinned) {
    api("pinChanComment", {
      id: id,
      pinned: pinned,
      clientId: clientId,
      clientSecret: secret,
    })
      .then(function () {
        toast(pinned ? "已置顶" : "已取消置顶");
        reload();
      })
      .catch(function (e) {
        toast(errorText(e));
      });
  }

  /* ------------------------------------------------ 管理员消息 / 头像角标 */

  var LS_INBOX_SEEN = "chan:admin:inboxSeen";
  var adminDock = null;
  var adminBadge = null;
  var adminMenu = null;
  var adminTimer = 0;
  var inboxEl = null;
  var inboxList = null;
  var inboxItems = [];
  var inboxFetching = false;
  var inboxReplyOpen = null;

  function inboxSeen() {
    var n = Number(readLS(LS_INBOX_SEEN));
    if (!n) {
      n = Date.now();
      writeLS(LS_INBOX_SEEN, String(n));
    }
    return n;
  }

  function markInboxRead() {
    writeLS(LS_INBOX_SEEN, String(Date.now()));
    if (adminBadge) {
      adminBadge.hidden = true;
      adminBadge.textContent = "";
    }
  }

  function setAdminBadge(n) {
    if (!adminBadge) return;
    n = Number(n) || 0;
    adminBadge.textContent = n > 99 ? "99+" : String(n);
    adminBadge.hidden = n <= 0;
  }

  function renderAdminAvatar() {
    if (!adminDock) return;
    var box = adminDock.querySelector(".chan-admin-dock__avatar");
    if (!box) return;
    box.innerHTML = "";
    if (myAvatar) {
      var img = document.createElement("img");
      img.src = myAvatar;
      img.alt = "";
      box.appendChild(img);
    } else {
      box.textContent =
        String(savedName() || "管").replace(/^@+/, "").trim().charAt(0) || "管";
    }
  }

  function ensureAdminDock() {
    if (adminDock) return;
    adminDock = el("div", "chan-admin-dock");
    adminDock.id = "chanAdminDock";
    adminDock.hidden = true;

    var btn = el("button", "chan-admin-dock__btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "管理员消息");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.title = "管理员消息";
    var avatar = el("span", "chan-admin-dock__avatar");
    adminBadge = el("span", "chan-admin-dock__badge");
    adminBadge.hidden = true;
    btn.appendChild(avatar);
    btn.appendChild(adminBadge);

    adminMenu = el("div", "chan-admin-menu");
    adminMenu.hidden = true;
    adminMenu.setAttribute("role", "menu");
    var view = el("button", "", "查看消息");
    view.type = "button";
    view.setAttribute("role", "menuitem");
    view.addEventListener("click", function () {
      adminMenu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      openInbox();
    });
    adminMenu.appendChild(view);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = adminMenu.hidden;
      adminMenu.hidden = !willOpen;
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (!adminDock || adminDock.hidden) return;
      if (!adminDock.contains(e.target)) {
        adminMenu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });

    adminDock.appendChild(btn);
    adminDock.appendChild(adminMenu);
    document.body.appendChild(adminDock);
    renderAdminAvatar();
  }

  function startAdminInbox() {
    ensureAdminDock();
    if (!adminDock) return;
    adminDock.hidden = false;
    renderAdminAvatar();
    var btn = adminDock.querySelector(".chan-admin-dock__btn");
    if (btn) btn.title = (savedName() || "管理员") + "的消息";
    inboxSeen();
    fetchInbox();
    if (!adminTimer) {
      adminTimer = window.setInterval(fetchInbox, 25000);
    }
  }

  function stopAdminInbox() {
    if (adminDock) adminDock.hidden = true;
    if (adminTimer) {
      window.clearInterval(adminTimer);
      adminTimer = 0;
    }
  }

  function fetchInbox() {
    if (inboxFetching || !adminDock || adminDock.hidden) return;
    inboxFetching = true;
    api(
      "getChanAdminInbox",
      { clientId: clientId, clientSecret: secret },
      40000
    )
      .then(function (j) {
        inboxItems = (j && j.items) || [];
        var seen = inboxSeen();
        setAdminBadge(
          inboxItems.filter(function (it) {
            return (Number(it.createdAt) || 0) > seen;
          }).length
        );
        if (inboxEl && !inboxEl.hidden) renderInbox();
      })
      .catch(function (e) {
        if (inboxEl && !inboxEl.hidden) toast(errorText(e));
      })
      .then(function () {
        inboxFetching = false;
      });
  }

  function ensureInbox() {
    if (inboxEl) return;
    inboxEl = el("div", "chan-inbox");
    inboxEl.hidden = true;
    var box = el("div", "chan-inbox__box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "消息汇总");
    var head = el("div", "chan-inbox__head");
    var title = el("h2", "", "消息汇总");
    var close = el("button", "chan-inbox__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭消息汇总");
    close.addEventListener("click", closeInbox);
    head.appendChild(title);
    head.appendChild(close);
    inboxList = el("div", "chan-inbox__list");
    box.appendChild(head);
    box.appendChild(inboxList);
    inboxEl.appendChild(box);
    inboxEl.addEventListener("click", function (e) {
      if (e.target === inboxEl) closeInbox();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && inboxEl && !inboxEl.hidden) closeInbox();
    });
    document.body.appendChild(inboxEl);
  }

  function openInbox() {
    ensureInbox();
    if (!inboxEl) return;
    markInboxRead();
    inboxEl.hidden = false;
    inboxList.innerHTML = "";
    inboxList.appendChild(el("p", "chan-inbox__empty", "正在加载消息…"));
    fetchInbox();
  }

  function closeInbox() {
    if (!inboxEl) return;
    inboxEl.hidden = true;
    inboxReplyOpen = null;
  }

  function goToInboxItem(item) {
    if (!item) return;
    closeInbox();
    location.hash = "#l" + item.lessonNo;
    var tries = 0;
    function findTarget() {
      var target = document.querySelector(
        '.chan-comment[data-id="' + item.id + '"]'
      );
      if (target) {
        target.scrollIntoView({ block: "center" });
        return;
      }
      var sec = document.querySelector(
        '.chan-lesson[data-no="' + item.lessonNo + '"]'
      );
      if (sec && tries > 2) {
        var box = sec.querySelector(".chan-comments");
        if (box) box.scrollIntoView({ block: "start" });
      }
      tries += 1;
      if (tries < 9) window.setTimeout(findTarget, 350);
    }
    window.setTimeout(findTarget, 450);
  }

  function renderInbox() {
    if (!inboxList) return;
    inboxList.innerHTML = "";
    if (!inboxItems.length) {
      inboxList.appendChild(el("p", "chan-inbox__empty", "暂无新消息"));
      return;
    }
    inboxItems.forEach(function (item) {
      var card = el("article", "chan-inbox__item");
      card.setAttribute("data-id", item.id);
      card.addEventListener("click", function (e) {
        var t = e.target;
        if (
          t &&
          t.closest &&
          t.closest("button, input, textarea, .chan-inbox__replyform")
        ) {
          return;
        }
        goToInboxItem(item);
      });

      var who = String(item.name || "匿名读者").replace(/^@+/, "");
      var head = el("div", "chan-inbox__item-head");
      var av = el("span", "chan-inbox__avatar", who.charAt(0) || "匿");
      var meta = el("div", "chan-inbox__meta");
      var name = el("b", "", who);
      var sub = el(
        "span",
        "",
        "第 " + item.lessonNo + " 课 · " + formatTime(item.createdAt)
      );
      meta.appendChild(name);
      meta.appendChild(sub);
      head.appendChild(av);
      head.appendChild(meta);

      var main = el("div", "chan-inbox__main");
      if (item.replyToName) {
        main.appendChild(
          el(
            "p",
            "chan-inbox__replyto",
            "回复 " + String(item.replyToName).replace(/^@+/, "")
          )
        );
      }
      if (item.content) {
        main.appendChild(el("p", "chan-inbox__body", item.content));
      }
      if (item.images && item.images.length) {
        var imgs = el("div", "chan-inbox__images");
        item.images.forEach(function (src, i) {
          var img = document.createElement("img");
          img.src = src;
          img.alt = "消息图片";
          img.loading = "lazy";
          img.addEventListener("click", function (e) {
            e.stopPropagation();
            openGallery(item.images, i);
          });
          imgs.appendChild(img);
        });
        main.appendChild(imgs);
      }
      if (item.imagesHidden) {
        main.appendChild(el("p", "chan-inbox__images-note", "还有图片，打开原文查看"));
      }

      var acts = el("div", "chan-inbox__acts");
      var reply = el("button", "", "回复");
      reply.type = "button";
      reply.addEventListener("click", function (e) {
        e.stopPropagation();
        openInboxReply(card, item);
      });
      var open = el("button", "", "查看原文");
      open.type = "button";
      open.addEventListener("click", function (e) {
        e.stopPropagation();
        goToInboxItem(item);
      });
      acts.appendChild(reply);
      acts.appendChild(open);
      main.appendChild(acts);
      card.appendChild(head);
      card.appendChild(main);
      inboxList.appendChild(card);
    });
  }

  function openInboxReply(card, item) {
    if (inboxReplyOpen && inboxReplyOpen !== card) {
      var old = inboxReplyOpen.querySelector(".chan-inbox__replyform");
      if (old) old.remove();
    }
    if (card.querySelector(".chan-inbox__replyform")) {
      card.querySelector(".chan-inbox__replyform").remove();
      inboxReplyOpen = null;
      return;
    }
    var form = el("div", "chan-comments__compose chan-inbox__replyform");
    var ta = el("textarea");
    ta.maxLength = 1000;
    ta.placeholder = "回复 " + String(item.name || "读者").replace(/^@+/, "") + "…";
    ta.setAttribute("aria-label", "回复内容");
    form.appendChild(ta);
    var picker = createImagePicker();
    form.appendChild(picker.thumbs);
    var row = el("div", "chan-comments__compose-row");
    var send = el("button", "chan-comments__submit", "回复");
    send.type = "button";
    row.appendChild(picker.node);
    row.appendChild(send);
    form.appendChild(row);

    function submit() {
      var text = String(ta.value || "").trim();
      var images = picker.values();
      if (!text && !images.length) {
        toast("写点回复或加张图片");
        ta.focus();
        return;
      }
      send.disabled = true;
      picker.setDisabled(true);
      send.textContent = "回复中…";
      api(
        "createChanComment",
        {
          lessonNo: item.lessonNo,
          parentId: item.id,
          content: text,
          images: images,
          name: String(savedName() || "").trim().slice(0, 20),
          clientId: clientId,
          clientSecret: secret,
        },
        40000
      )
        .then(function () {
          toast("回复已发布");
          form.remove();
          inboxReplyOpen = null;
          if (item.lessonNo === lessonNo) reload();
          fetchInbox();
        })
        .catch(function (e) {
          send.disabled = false;
          send.textContent = "回复";
          picker.setDisabled(false);
          toast(errorText(e));
        });
    }
    send.addEventListener("click", submit);
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    card.appendChild(form);
    inboxReplyOpen = card;
    ta.focus();
  }

  document.addEventListener("chan:lesson", function (e) {
    var no = e && e.detail ? Number(e.detail.no) : 0;
    if (!no || no === lessonNo) return;
    lessonNo = no;
    state = null;
    replyOpen = null;
    load(no);
  });

  (function init() {
    var sec = activeSection();
    if (!sec) return;
    lessonNo = Number(sec.getAttribute("data-no")) || 1;
    load(lessonNo);
    fetchMyAvatar();
  })();
})();

"""aibuilder.top 官网构建脚本（独立仓库，不依赖 App 代码）。

把 site/ 下的模板渲染成 site/dist/ 里可直接部署的静态站点，并生成
version.json（App 更新检查用，随站点部署到 /huideng/ 子目录）。

版本号与安装包只认本仓库的两处：
  site/release.json          版本号 / versionCode / 发布说明
  site/downloads/huideng.apk  下发的安装包（不入 git）

用法:
  python tools/build_site.py --sync           # 重建站点（不部署）
  python tools/build_site.py --apk <路径>      # 临时用别的 APK 构建
  python tools/build_site.py --dry-run        # 只生成站点，部署交给 update_site.py
  python tools/update_site.py --apk <apk> --version 3.5.3+39   # 发新版并部署

发布到腾讯云 CloudBase 静态托管（根目录 + /huideng 子目录）:
  tcb hosting deploy site/dist -e <环境ID>
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html
import json
import pathlib
import re
import shutil
import sys
import zipfile

try:
    from PIL import Image

    _HAS_PIL = True
except ImportError:  # 缺 Pillow 就照原样复制，页面里仍是 .png
    Image = None
    _HAS_PIL = False

# Windows 控制台默认 GBK，中文输出会直接抛 UnicodeEncodeError（报错信息走 stderr）。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DIST = SITE / "dist"
CONFIG_PATH = SITE / "site.config.json"
CHANGELOG_PATH = SITE / "changelog.json"
RELEASE_PATH = SITE / "release.json"
DOWNLOADS = SITE / "downloads"
DEFAULT_APK = DOWNLOADS / "huideng.apk"

LEGAL_DOCS = {
    "privacy": {
        "title": "隐私政策",
        "source": SITE / "data" / "legal" / "privacy_policy.md",
    },
    "terms": {
        "title": "用户协议",
        "source": SITE / "data" / "legal" / "user_agreement.md",
    },
}

# 协议页由 site/data/legal/ 现场生成，模板本身不部署。
# 社区邀请页同理：community.template.html 只当模板，逐栏目渲染成
# dist/community/<slug>.html（数据真源是 site/data/communities.json）。
# 缠论读书会也一样：chan.template.html + site/data/chan-lessons.json
# 渲染成 dist/chan/index.html，正文数据由 tools/extract_chan.py 从 Word 抽出。
TEMPLATES = {"legal.template.html", "community.template.html", "chan.template.html"}


def site_html_sources() -> list[pathlib.Path]:
    """要渲染的页面源文件：site/ 及其子目录（app/、trade/），排除产物与模板。

    dist/ 是构建输出，必须排除，否则会把自己当输入再渲染一遍。
    """
    out = []
    for p in sorted(SITE.rglob("*.html")):
        rel = p.relative_to(SITE)
        if rel.parts[0] in {"dist", ".freebuff"}:
            continue
        if p.name in TEMPLATES:
            continue
        out.append(p)
    return out


# --------------------------------------------------------------------------
# 读取
# --------------------------------------------------------------------------


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def read_release() -> dict:
    """读 site/release.json：官网当前对外发布的版本信息。

    发版由 tools/update_site.py --apk ... --version x.y.z+NN 写入，
    单独改页面内容不需要动它。
    """
    if not RELEASE_PATH.is_file():
        raise SystemExit("缺 site/release.json，先跑：python tools/update_site.py --help")
    data = json.loads(RELEASE_PATH.read_text(encoding="utf-8"))
    version = str(data.get("version") or "").strip()
    code = data.get("versionCode")
    if not version or not isinstance(code, int):
        raise SystemExit("site/release.json 的 version / versionCode 不完整")
    return data


def _read_axml_strings(data: bytes) -> list[str]:
    """取出 AXML 首个字符串池里的全部字符串。"""
    if len(data) < 8 or int.from_bytes(data[0:2], "little") != 0x0003:
        return []

    strings: list[str] = []
    pos = 8  # 跳过 XML 文档头
    while pos + 8 <= len(data):
        ctype = int.from_bytes(data[pos : pos + 2], "little")
        chunk_size = int.from_bytes(data[pos + 4 : pos + 8], "little")
        if chunk_size < 8 or pos + chunk_size > len(data):
            break

        if ctype == 0x0001:  # RES_STRING_POOL_TYPE
            count = int.from_bytes(data[pos + 8 : pos + 12], "little")
            flags = int.from_bytes(data[pos + 16 : pos + 20], "little")
            strings_start = int.from_bytes(data[pos + 20 : pos + 24], "little")
            # 偏移表紧跟 28 字节的块头。
            offsets_at = pos + 28
            is_utf8 = bool(flags & 0x80)

            for i in range(count):
                at = offsets_at + i * 4
                if at + 4 > pos + chunk_size:
                    break
                off = int.from_bytes(data[at : at + 4], "little")
                p = pos + strings_start + off
                if p + 2 > len(data):
                    strings.append("")
                    continue
                if is_utf8:
                    # UTF-8：u8 utf16 长度、u8 utf8 长度、字节、0x00
                    n8 = data[p + 1]
                    strings.append(data[p + 2 : p + 2 + n8].decode("utf-8", "replace"))
                else:
                    # UTF-16：u16 字符数、内容、0x0000
                    n16 = int.from_bytes(data[p : p + 2], "little")
                    strings.append(
                        data[p + 2 : p + 2 + n16 * 2].decode("utf-16-le", "replace")
                    )
            return strings

        pos += chunk_size
    return []


def apk_version_code(path: pathlib.Path) -> int | None:
    """从 APK 的 AndroidManifest.xml 里读 manifest 节点的 versionCode。

    AndroidManifest.xml 是 AXML 二进制格式：这里按块结构取出字符串池，
    再遍历 START_ELEMENT 的属性表，找 name 为 versionCode 的那一项，
    取其 typedValue.data。取不到返回 None，由调用方决定是否算硬错误。
    """
    try:
        with zipfile.ZipFile(path) as zf:
            data = zf.read("AndroidManifest.xml")
    except (KeyError, zipfile.BadZipFile, OSError):
        return None

    strings = _read_axml_strings(data)
    if not strings:
        return None

    def s(idx: int) -> str:
        return strings[idx] if 0 <= idx < len(strings) else ""

    pos = 8
    while pos + 8 <= len(data):
        ctype = int.from_bytes(data[pos : pos + 2], "little")
        chunk_size = int.from_bytes(data[pos + 4 : pos + 8], "little")
        if chunk_size < 8 or pos + chunk_size > len(data):
            break

        # START_ELEMENT: 头 16 字节后是 attr 起始/大小/个数，再跟属性表。
        if ctype == 0x0102:
            name_idx = int.from_bytes(data[pos + 20 : pos + 24], "little")
            attr_start = int.from_bytes(data[pos + 24 : pos + 26], "little")
            attr_size = int.from_bytes(data[pos + 26 : pos + 28], "little")
            attr_count = int.from_bytes(data[pos + 28 : pos + 30], "little")

            if s(name_idx) == "manifest" and attr_size >= 20:
                base = pos + 16 + attr_start
                for i in range(attr_count):
                    a = base + i * attr_size
                    if a + 20 > len(data):
                        break
                    attr_name = s(int.from_bytes(data[a + 4 : a + 8], "little"))
                    if attr_name == "versionCode":
                        return int.from_bytes(data[a + 16 : a + 20], "little")

        pos += chunk_size
    return None


def copy_assets() -> None:
    """把 site/assets 复制到 dist，并把截图归一化成 JPEG。

    源图只读不动（体积大、尺寸也略有出入），产物统一成 852x1846 的
    JPEG q88：实测比原 PNG 小约 88%，且全平台支持，页面不会因为四张
    截图进 6MB 而拖慢首屏。HTML 里引用的是 shot-*.jpg。
    """
    if not _HAS_PIL:
        raise SystemExit(
            "缺 Pillow，无法压缩截图：pip install pillow\n"
            "（缺了它页面会引用不到 shot-*.jpg）"
        )

    dest = DIST / "assets"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SITE / "assets", dest)

    sources = list(dest.glob("shot-*.png")) + list(dest.glob("shot-*.jpg"))
    if not sources:
        print("提示      没有 shot-*.png/jpg，截图位将为空")

    for src in sorted(sources):
        target = dest / (src.stem + ".jpg")
        try:
            im = Image.open(src).convert("RGB")
        except (OSError, Image.UnidentifiedImageError) as exc:
            print(f"警告      跳过无法读取的截图 {src.name}（{exc}）")
            continue
        if im.size != SHOT_SIZE:
            im = im.resize(SHOT_SIZE, Image.LANCZOS)
        im.save(
            target,
            format="JPEG",
            quality=SHOT_QUALITY,
            optimize=True,
            progressive=True,
        )
        before = src.stat().st_size / 1024
        after = target.stat().st_size / 1024
        print(f"截图      {src.name} -> {target.name}   {before:.0f} -> {after:.0f} KB")
        if src != target and src.exists():
            src.unlink()


# 截图归一化尺寸与质量，须与 site.css 里的 aspect-ratio 保持一致。
SHOT_SIZE = (852, 1846)
SHOT_QUALITY = 88


def find_apk(explicit: str | None) -> pathlib.Path:
    if explicit:
        p = pathlib.Path(explicit)
        if not p.is_absolute():
            p = pathlib.Path.cwd() / p
        if not p.is_file():
            raise SystemExit(f"指定的 APK 不存在：{p}")
        return p
    if DEFAULT_APK.is_file():
        return DEFAULT_APK
    raise SystemExit(
        "site/downloads/huideng.apk 不存在。发新版请运行：\n"
        "  python tools/update_site.py --apk <App 打出来的 apk> --version x.y.z+NN\n"
        "或本次临时用 --apk 指定安装包路径。"
    )


def human_size(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def sha256_of(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------
# Markdown → HTML
# --------------------------------------------------------------------------


def inline_md(text: str) -> str:
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        r'<a href="\2">\1</a>',
        out,
    )
    return out


def _strip_legal_banner(md: str) -> str:
    """去掉协议开头的标题与生效日期行。

    这两处在页面模板里已经各有一处（页头大标题 + 生效日期徽章），
    正文里再出现一次就是重复。这里只动开头两行，正文内容不改。
    """
    lines = md.splitlines()
    i = 0
    # 跳过 md 允许的、开头那行之下的空行
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i < len(lines) and re.match(r"^#\s+", lines[i].strip()):
        i += 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    # 生效日期独占一行，或被整行加粗
    if i < len(lines) and re.search(r"生效日期", lines[i]):
        i += 1
    return "\n".join(lines[i:]).strip("\n")


def md_to_html(md: str) -> str:
    """把协议 md 转成 HTML。

    只覆盖这两份文件实际用到的语法：一到三级标题、有序/无序列表、
    加粗、行内链接、段落。够用即可，不引第三方库。
    """
    out: list[str] = []
    list_kind: str | None = None

    def close_list() -> None:
        nonlocal list_kind
        if list_kind:
            out.append(f"</{list_kind}>")
            list_kind = None

    body = _strip_legal_banner(md)

    for raw in body.splitlines():
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            close_list()
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            close_list()
            level = min(len(m.group(1)), 3)
            out.append(f"<h{level}>{inline_md(m.group(2))}</h{level}>")
            continue

        m = re.match(r"^(\d+)[.)]\s+(.*)$", stripped)
        if m:
            if list_kind != "ol":
                close_list()
                out.append("<ol>")
                list_kind = "ol"
            out.append(f"<li>{inline_md(m.group(2))}</li>")
            continue

        m = re.match(r"^[-*+]\s+(.*)$", stripped)
        if m:
            if list_kind != "ul":
                close_list()
                out.append("<ul>")
                list_kind = "ul"
            out.append(f"<li>{inline_md(m.group(1))}</li>")
            continue

        close_list()
        out.append(f"<p>{inline_md(stripped)}</p>")

    close_list()
    return "\n".join(out)


def legal_updated(md: str) -> str:
    m = re.search(r"生效日期[:：]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", md)
    if m:
        return f"{m.group(1)} 年 {int(m.group(2))} 月 {int(m.group(3))} 日"
    return ""


def write_qr(target: pathlib.Path, url: str) -> str:
    """生成下载页二维码 PNG。指向 download.html 这类固定地址，永不过期。"""
    try:
        import segno
    except ImportError:
        return ""
    qr = segno.make(url, error="m")
    qr.save(target, scale=10, border=3, dark="#1A1A1A", light="#FFFFFF")
    return url


# --------------------------------------------------------------------------
# 片段
# --------------------------------------------------------------------------


def beian_html(config: dict) -> str:
    """页脚备案号片段：ICP 备案号链工信部，公安备案号链公安部查询页。

    两个来源都是 site.config.json 的可选字段；谁没填就不渲染，
    保证备案下来之前（之后）站点都能随时构建。
    """
    parts: list[str] = []
    icp = (config.get("icpNumber") or "").strip()
    if icp:
        parts.append(
            f'<a href="https://beian.miit.gov.cn/" target="_blank" '
            f'rel="noopener noreferrer">{html.escape(icp)}</a>'
        )
    police = (config.get("policeRecordNumber") or "").strip()
    if police:
        # 公安备案号如「豫公网安备 41010202026XXX号」；
        # 记录码取备案号尾部数字（公安查询系统的 recordcode）。
        m = re.search(r"(\d{6,})", police.replace(" ", ""))
        code = m.group(1) if m else ""
        parts.append(
            f'<a href="https://beian.mps.gov.cn/#/query/webSearch?code={code}" '
            f'target="_blank" rel="noopener noreferrer">{html.escape(police)}</a>'
        )
    return "&nbsp;·&nbsp;".join(parts)


def render_log(releases: list[dict], latest: str) -> str:
    items = []
    for i, r in enumerate(releases):
        is_latest = r["version"] == latest
        cls = "log__item log__item--latest" if is_latest else "log__item"
        badge = '<span class="log__badge">当前版本</span>' if is_latest else ""
        items.append(
            f'<div class="{cls}">'
            f'<div class="log__ver">'
            f"<h3>v{html.escape(r['version'])}</h3>{badge}"
            f'<span class="log__date">{html.escape(r.get("date", ""))}</span>'
            f"</div>"
            f'<div class="log__body">{html.escape(r.get("notes", ""))}</div>'
            f"</div>"
        )
    return "\n".join(items)


# --------------------------------------------------------------------------
# 社区邀请页（八大宗派 + 十二法门，共 20 页）
#
# 数据真源是本仓库自带的 site/data/communities.json 与 site/assets/sect/*.png，
# 不再读 App 仓库。改栏目只需改 JSON，然后重跑：
#   python tools/build_site.py --sync
# --------------------------------------------------------------------------

COMMUNITY_TPL = SITE / "community.template.html"


def cloud_api() -> tuple[str, str]:
    """云函数网关地址与匿名凭证。

    社区邀请页、帖子分享页（site/post.html）都由浏览器直接调公开接口，
    这里取 site/site.config.json 的 api 段，避免两处写死。
    换环境 / 换 key 时与 App 的 lib/cloudbase_config.dart 一起改。
    """
    cfg = load_config().get("api") or {}
    env_id = (cfg.get("envId") or "").strip()
    api_key = (cfg.get("accessKey") or "").strip()
    if not env_id or not api_key:
        raise SystemExit("site/site.config.json 缺少 api.envId / api.accessKey")
    return (
        f"https://{env_id}.api.tcloudbasegateway.com/v1/functions/api",
        api_key,
    )


def load_communities() -> list[dict]:
    """读 site/data/communities.json：20 个栏目落地页的全部字段。"""
    path = SITE / "data" / "communities.json"
    if not path.is_file():
        raise SystemExit(f"缺 {path.relative_to(ROOT)}")
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("communities") or []
    if len(items) != 20:
        raise SystemExit(f"communities.json 的栏目数不是 20：{len(items)}")
    slugs = [c["slug"] for c in items]
    if len(set(slugs)) != len(slugs):
        raise SystemExit("communities.json 里 slug 有重复")
    for c in items:
        if not (SITE / c["icon"]).is_file():
            raise SystemExit(f"社区图标不存在：{(SITE / c['icon']).relative_to(ROOT)}")
    return items


def build_communities(common: dict) -> int:
    """渲染 20 页邀请页到 dist/community/，并把各自图标复制到 dist/assets/sect/。"""
    communities = load_communities()
    tpl = COMMUNITY_TPL.read_text(encoding="utf-8")

    icon_out = DIST / "assets" / "sect"
    icon_out.mkdir(parents=True, exist_ok=True)
    page_out = DIST / "community"
    page_out.mkdir(parents=True, exist_ok=True)

    for c in communities:
        # publishable key 本就是给客户端匿名用的（APK 里同样明文），
        # 放进页面只影响「谁都能调公开接口」——与 App 的权限面一致。
        values = {
            **common,
            "NAME": c["name"],
            "SLUG": c["slug"],
            "DESC": html.escape(c["desc"], quote=True),
            "INTRO": html.escape(c["intro"], quote=True),
            "ICON": f"../assets/sect/{c['slug']}.png",
            "DOWNLOAD_HREF": "../download.html",
            "COMMUNITY_KEY": f"{c['name']}社区",
        }
        out = tpl
        for key, value in values.items():
            out = out.replace("{{" + key + "}}", str(value))
        left = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", out)))
        if left:
            raise SystemExit(f"community/{c['slug']}.html 还有未替换的占位符：{left}")
        (page_out / f"{c['slug']}.html").write_text(out, encoding="utf-8")
        shutil.copy2(SITE / c["icon"], icon_out / f"{c['slug']}.png")

    print(f"社区页    {len(communities)} 页 -> community/<slug>.html")
    return len(communities)


# --------------------------------------------------------------------------
# 全站侧边栏导航：顶部菜单栏统一改成左侧可折叠侧边栏
# --------------------------------------------------------------------------

SIDE_ICONS = {
    "trade": '<path d="M4 19.5V4.5"/><path d="M4 19.5h16"/><path d="M7.5 15.5l4-4.5 3 3 4.5-6"/>',
    "chan": (
        '<path d="M12 6.6C10.5 5.3 8.4 4.7 5.6 4.7V18c2.8 0 4.9.6 6.4 1.9'
        ' 1.5-1.3 3.6-1.9 6.4-1.9V4.7c-2.8 0-4.9.6-6.4 1.9Z"/><path d="M12 6.6V20"/>'
    ),
    "stocks": (
        '<path d="m12 4.2 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z"/>'
    ),
    "app": (
        '<path d="M12 3.6 20 7.3l-8 3.7-8-3.7z"/><path d="M4 12l8 3.7 8-3.7"/>'
        '<path d="M4 16.4l8 3.7 8-3.7"/>'
    ),
}

SIDE_LINKS = (
    ("trade", "index.html", "交易练习", ""),
    ("chan", "chan/index.html", "缠中说禅", ""),
    ("stocks", "stocks/index.html", "乘法自选", ""),
    ("app", "index.html#app", "大正藏经", ""),
)

# 哪个页面高亮哪一项
# 交易复盘（review/index.html）不再进菜单：它现在挂在交易练习页右下角按钮上，
# 单独打开时高亮「交易练习」。
NAV_CURRENT = {
    "index.html": "trade",
    "review/index.html": "trade",
    "chan/index.html": "chan",
    "stocks/index.html": "stocks",
    "app/index.html": "app",
}

# 交易练习页把账户菜单挪进侧边栏底部，登录 / 换头像 / 重置资金都还在。
TRADE_ACCOUNT_SIDE = """<div class="topnav__account">
      <button type="button" class="avatar-btn" id="btnMenu" aria-label="账户菜单" aria-haspopup="menu" aria-expanded="false" aria-controls="acctMenu">
        <img src="{rel}assets/icon.png" alt="">
        <span class="avatar-badge" id="menuAvatarBadge" hidden></span>
      </button>
      <div class="acct-menu" id="acctMenu" role="menu" aria-label="账户" hidden>
        <div class="acct-menu__who" id="menuWho">未登录 · 本机账户</div>
        <button type="button" role="menuitem" data-act="messages" id="menuMessages" hidden>查看消息<span class="acct-menu__msg-badge" id="menuMessagesBadge" hidden></span></button>
        <button type="button" role="menuitem" data-act="account" id="menuAccount" aria-expanded="false" aria-controls="accountSub">我的账户</button>
        <div class="acct-menu__sub" id="accountSub" hidden>
          <button type="button" role="menuitem" data-act="name" id="menuName">我的名字</button>
          <button type="button" role="menuitem" data-act="avatar" id="menuAvatar" hidden>更换头像</button>
          <button type="button" role="menuitem" data-act="email" id="menuEmail" hidden>绑定邮箱</button>
        </div>
        <button type="button" role="menuitem" data-act="login" id="menuLogin">登录 / 注册</button>
        <button type="button" role="menuitem" data-act="sync" id="menuSync" hidden>同步交易记录</button>
        <button type="button" role="menuitem" data-act="flatten" id="menuFlatten">一键清仓</button>
        <button type="button" role="menuitem" data-act="reset" id="menuReset">重置资金</button>
        <button type="button" role="menuitem" data-act="logout" id="menuLogout" hidden>退出登录</button>
      </div>
    </div>"""


def render_side(common: dict, rel: str, current: str, extra: str = "", views: bool = False) -> str:
    """渲染全站统一的顶部横向菜单。

    current 决定哪一项高亮；extra 放左上角那块（交易练习页是账户头像）；
    views=True 是交易练习页（单页四条轨道），站内轨道页都带 data-view。
    """
    items = []
    for key, href, label, extra_attrs in SIDE_LINKS:
        on = key == current
        attrs = f' data-nav="{key}"' + extra_attrs
        # 首页四个内嵌视图都带 data-view；stocks 现在也是其中之一。
        if views and key in {"trade", "chan", "stocks", "app"}:
            attrs += f' data-view="{key}"'
        if on:
            attrs += ' aria-current="page"'
        cls = "topnav__item is-on" if on else "topnav__item"
        items.append(
            f'<a class="{cls}" href="{rel}{href}"{attrs}>'
            f'<svg class="topnav__ico" viewBox="0 0 24 24" aria-hidden="true" fill="none"'
            f' stroke="currentColor" stroke-width="1.7" stroke-linecap="round"'
            f' stroke-linejoin="round">{SIDE_ICONS[key]}</svg>'
            f'<span>{label}</span></a>'
        )
    menu = "\n      ".join(items)

    return f"""<header class="topnav">
  <div class="topnav__inner">
    {extra}
    <nav class="topnav__menu" aria-label="主导航">
      {menu}
    </nav>
  </div>
</header>"""


# --------------------------------------------------------------------------
# 缠论读书会（/chan/）：108 课正文全部写进一个静态页面
# --------------------------------------------------------------------------

CHAN_TPL = SITE / "chan.template.html"
CHAN_DATA = SITE / "data" / "chan-lessons.json"


def _chan_paragraph(block: dict, fig_no: list[int], rel: str) -> str:
    kind = block["t"]
    if kind == "p":
        return f'<p>{html.escape(block["x"])}</p>'
    if kind == "date":
        return f'<p class="chan-stamp">{html.escape(block["x"])}</p>'
    if kind == "h":
        # 书里的小标题：缠论点睛 / 投资微言 / 注释
        return f'<p class="chan-subhead">{html.escape(block["x"])}</p>'
    if kind == "note":
        # 脚注：小字、浅底，跟在每课末尾
        return f'<p class="chan-footnote">{html.escape(block["x"])}</p>'
    if kind == "img":
        fig_no[0] += 1
        w, h = block.get("w") or 0, block.get("h") or 0
        inline = bool(w) and w < 120
        size = f' width="{w}" height="{h}"' if w and h else ""
        if block.get("cap"):
            caption = f'<figcaption>{html.escape(block["cap"])}</figcaption>'
        elif inline:
            caption = ""
        else:
            caption = f"<figcaption>图 {fig_no[0]}</figcaption>"
        cls = "chan-fig chan-fig--inline" if inline else "chan-fig"
        return (
            f'<figure class="{cls}">'
            f'<img src="{rel}{block["src"]}"{size} loading="lazy" decoding="async"'
            f' alt="本课插图 {fig_no[0]}">'
            f"{caption}</figure>"
        )
    if kind == "table":
        rows = "".join(
            "<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in row) + "</tr>"
            for row in block.get("rows", [])
        )
        return f'<table class="chan-table">{rows}</table>'
    return ""


def _chan_lesson_html(lesson: dict, rel: str) -> str:
    no = lesson["no"]
    title = html.escape(lesson["short"], quote=True)
    first = ' is-on' if no == 1 else ""
    meta = []
    if lesson.get("date"):
        day, _, clock = lesson["date"].partition(" ")
        meta.append(
            f'<time datetime="{day}T{clock}">{lesson["date"]}</time>'
        )
    minutes = max(1, round(lesson["chars"] / 480))
    meta.append(f"<span>约 {minutes} 分钟</span>")
    meta.append(f"<span>{lesson['chars']:,} 字</span>")

    fig_no = [0]
    body = "".join(_chan_paragraph(b, fig_no, rel) for b in lesson["blocks"])

    return (
        f'<section class="chan-lesson{first}" id="l{no:03d}" data-no="{no}"'
        f' data-title="第 {no} 课 · {title}">\n'
        f'  <header class="chan-lesson__head">\n'
        f'    <p class="chan-lesson__eyebrow">第 {no} 课</p>\n'
        f'    <h2 class="chan-lesson__title">{title}</h2>\n'
        f'    <p class="chan-lesson__meta">{"".join(meta)}</p>\n'
        f'  </header>\n'
        f'  <div class="chan-prose">\n{body}\n  </div>\n'
        f'  <section class="chan-comments" data-lesson-comments="{no}"'
        f' aria-label="第 {no} 课提问"></section>\n'
        f"</section>"
    )


def _chan_toc_html(lessons: list[dict]) -> str:
    rows = []
    for lesson in lessons:
        no = lesson["no"]
        search = f'第{no}课 第 {no} 课 {lesson["title"]} {lesson["short"]}'.lower()
        rows.append(
            f'<li><a href="#l{no:03d}" data-no="{no}"'
            f' data-search="{html.escape(search, quote=True)}">'
            f'<span class="chan-toc__no">{no:02d}</span>'
            f'<span class="chan-toc__txt">{html.escape(lesson["short"])}</span></a></li>'
        )
    return "\n".join(rows)


def build_chan(common: dict) -> int:
    """渲染 108 课单页到 dist/chan/index.html。

    正文数据来自 tools/extract_chan.py 抽出的 JSON；这里只做 HTML 拼装，
    正文、插图、翻页链接全在构建期定死，部署后没有任何接口依赖。
    """
    if not CHAN_DATA.is_file():
        raise SystemExit(
            f"缺 {CHAN_DATA.relative_to(ROOT)}，先跑：python tools/extract_chan.py"
        )

    lessons = json.loads(CHAN_DATA.read_text(encoding="utf-8"))
    tpl = CHAN_TPL.read_text(encoding="utf-8")

    articles = []
    rel = "../"
    for lesson in lessons:
        articles.append(_chan_lesson_html(lesson, rel))

    chars = sum(l["chars"] for l in lessons)
    toc = _chan_toc_html(lessons)
    values = {
        **common,
        "REL": rel,
        "CHAN_COUNT": str(len(lessons)),
        "CHAN_CHARS": f"{chars / 10000:.1f} 万",
        "CHAN_ARTICLES": "\n".join(articles),
        "CHAN_TOC": toc,
        "SITE_NAV": render_side(common, rel, "chan"),
    }
    out = tpl
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", str(value))
    left = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", out)))
    if left:
        raise SystemExit(f"chan/index.html 还有未替换的占位符：{left}")

    target = DIST / "chan" / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(out, encoding="utf-8")
    print(
        f"缠论页    {len(lessons)} 课 / {chars:,} 字 -> chan/index.html"
        f"  {target.stat().st_size / 1024:.0f} KB"
    )
    return 1


# --------------------------------------------------------------------------
# 构建
# --------------------------------------------------------------------------


def build(args: argparse.Namespace) -> pathlib.Path:
    config = load_config()
    api_url, api_key = cloud_api()
    release = read_release()
    version = release["version"]
    version_code = int(release["versionCode"])
    today = _dt.date.today().isoformat()
    release_date = str(release.get("releaseDate") or today)

    apk = find_apk(args.apk)
    apk_size = apk.stat().st_size
    try:
        apk_label = str(apk.relative_to(ROOT))
    except ValueError:
        apk_label = str(apk)
    print(f"版本      v{version} (build {version_code})   ← site/release.json")
    print(f"APK       {apk_label}   {human_size(apk_size)}")

    # 版本一致性校验：APK 里的 versionCode 必须等于 pubspec 的 build 号。
    if not args.skip_verify:
        code = apk_version_code(apk)
        if code is None:
            print("警告      读不出 APK 的 versionCode，跳过校验（不影响构建）")
        elif code != version_code:
            raise SystemExit(
                f"版本号对不上：APK 内 versionCode={code}，"
                f"但 site/release.json 是 {version_code}。\n"
                f"请用正确版本发版：python tools/update_site.py --apk <apk> "
                f"--version {version}+{code}"
            )
        else:
            print(f"校验      APK versionCode={code} ✓")

    base = config["baseUrl"].rstrip("/")
    apk_url = base + config["apkPath"]
    # 页面按钮用不含前导斜杠的相对路径：本站所有页面都在同一目录，
    # 这样本地预览、正式域名、以及将来放到 /xxx/ 子路径下都能指到同一个文件；
    # 绝对的 apk_url 只留给 version.json（App 更新检查需要绝对地址）。
    apk_href = config["apkPath"].lstrip("/")
    apk_filename = config.get("apkFilename") or "huideng.apk"

    # 更新日志：--notes 传入时把新版本插到最前。
    changelog = json.loads(CHANGELOG_PATH.read_text(encoding="utf-8"))
    releases = changelog["releases"]
    notes = (release.get("notes") or "").strip()
    if not notes:
        notes = next(
            (r.get("notes", "") for r in releases if r["version"] == version),
            "",
        )
    if args.notes:
        notes = args.notes
        releases = [r for r in releases if r["version"] != version]
        releases.insert(
            0,
            {
                "version": version,
                "versionCode": version_code,
                "date": release_date,
                "notes": notes,
            },
        )
        changelog["releases"] = releases
        CHANGELOG_PATH.write_text(
            json.dumps(changelog, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"更新日志  已插入 v{version}（{release_date}）")

    # 页面文案里的 APK 体积会随每次构建变，下载页/首页都要跟着更新，
    # 所以所有页面都吃同一份 common 变量。
    # ASSET_VER = assets 下全部 css/js 的内容指纹，拼在 link/script 的查询串里。
    # 没有它浏览器会长期缓存旧样式和旧脚本，改了用户看不到（已实际踩过）。
    # 取整目录而不是单个 site.css：trade.css / trade.js 改动同样要能刷掉缓存。
    h = hashlib.md5()
    for asset in sorted((SITE / "assets").rglob("*")):
        if asset.is_file() and asset.suffix.lower() in {".css", ".js"}:
            h.update(asset.read_bytes())
    css_ver = h.hexdigest()[:8]

    # 品牌 logo 单独给一个内容指纹：换图后文件名不变，只靠 CDN/浏览器缓存
    # 就会一直显示旧图（已经踩过一次），拼在 src 的查询串上才能立刻刷新。
    # 图直接从 App 仓库里那张取（config.brandLogoSrc），换图后重跑构建即可，
    # 不必再手工 copy 到 site/assets——之前漏了这一步，线上一直挂着旧图。
    brand_logo = config.get("brandLogo") or "assets/icon.png"
    brand_src_rel = (config.get("brandLogoSrc") or "").strip()
    brand_src = (ROOT / brand_src_rel) if brand_src_rel else None
    brand_file = brand_src if (brand_src and brand_src.is_file()) else (SITE / brand_logo)
    try:
        logo_ver = hashlib.md5(brand_file.read_bytes()).hexdigest()[:8]
    except OSError:
        logo_ver = "0"

    common = {
        "SITE_NAME": config["siteName"],
        # 站点品牌（头部 logo + 名字）与 App 名分开：App 叫「燃灯」，
        # 站点对外叫「缠习社」。没配 brandName 时退回 siteName，
        # 老的「燃灯」模板不用改也能照常渲染。
        "BRAND_NAME": config.get("brandName") or config["siteName"],
        "BRAND_LOGO": brand_logo,
        "BRAND_LOGO_VER": logo_ver,
        "ASSET_VER": css_ver,
        "TAGLINE": config["tagline"],
        "DESCRIPTION": config["description"],
        "BASE_URL": base,
        "APK_URL": apk_url,
        "APK_HREF": apk_href,
        "APK_FILENAME": apk_filename,
        "APK_SIZE": human_size(apk_size),
        "APK_SHA256": sha256_of(apk) if not args.no_hash else "",
        "VERSION": version,
        "VERSION_CODE": str(version_code),
        "RELEASE_DATE": release_date,
        "NOTES": notes or "本次更新以修复与体验优化为主。",
        "YEAR": str(_dt.date.today().year),
        "MIN_ANDROID": config.get("minAndroid", ""),
        "PACKAGE_NAME": config.get("packageName", ""),
        "PLATFORM": config.get("platform", "Android"),
        "CONTACT_EMAIL": config.get("contactEmail", ""),
        "RELEASE_COUNT": str(len(releases)),
        "CHANGELOG_PREVIEW": render_log(releases[:3], version),
        "CHANGELOG_ALL": render_log(releases, version),
        "BEIAN_HTML": beian_html(config),
        "API_URL": api_url,
        "API_KEY": api_key,
        # 行情页可选的自建反代（site.config.json 的 market 段）。
        # 留空 = 直连 Binance；填了就会顶到数据源列表最前面。
        "MARKET_REST": (config.get("market") or {}).get("restBase", ""),
        "MARKET_WS": (config.get("market") or {}).get("wsBase", ""),
    }

    DIST.mkdir(parents=True, exist_ok=True)

    copy_assets()

    # 品牌图以 config.brandLogoSrc 为准：同步进 dist，并回写 site/assets 里的副本，
    # 页面引用的一直是 site/assets/<brandLogo>，这样换图只需重跑构建。
    if brand_src and brand_src.is_file() and brand_src != SITE / brand_logo:
        shutil.copy2(brand_src, DIST / brand_logo)
        shutil.copy2(brand_src, SITE / brand_logo)
        print(f"品牌图    {brand_src.relative_to(ROOT)} -> "
              f"{(SITE / brand_logo).relative_to(ROOT)}   v={logo_ver}")

    # 按钮链到 /downloads/xxx.apk，这里必须把包也放进 dist，
    # 否则部署后点击 404——链接和文件要成对落地。
    apk_dest = DIST / "downloads" / apk_filename
    apk_dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(apk, apk_dest)
    print(f"安装包    downloads/{apk_filename}   {human_size(apk_dest.stat().st_size)}")

    # 二维码指向 download.html（固定地址，页面内容随版本更新），所以只需生成一次。
    qr_target = DIST / "assets" / "qr-download.png"
    qr_url = write_qr(qr_target, f"{base}/download.html")
    if qr_url:
        print(f"二维码    assets/qr-download.png  ->  {qr_url}")
    else:
        print("警告      未安装 segno，跳过二维码生成（pip install segno）")

    # 顶层页面 REL=''，app/、trade/ 这类子目录页面 REL='../'。
    # 子目录模板里所有指向站点根的相对链接/资源都写成 {{REL}}xxx，
    # 顶层页面展开后就是原样，所以老页面一个字都不用改。
    pages = 0
    for src in site_html_sources():
        rel_path = src.relative_to(SITE)
        rel = "../" * (len(rel_path.parts) - 1)
        page = dict(common)
        page["REL"] = rel
        # 安装包按钮用相对路径（见上面 apk_href 的说明）：子目录要多退一级，
        # 否则部署后点下载会 404。
        page["APK_HREF"] = rel + apk_href

        nav_key = NAV_CURRENT.get(rel_path.as_posix(), "")
        extra = TRADE_ACCOUNT_SIDE.format(rel=rel) if rel_path.as_posix() == "index.html" else ""
        page["SITE_NAV"] = render_side(
            common, rel, nav_key, extra=extra, views=rel_path.as_posix() == "index.html"
        )

        out = src.read_text(encoding="utf-8")
        for key, value in page.items():
            out = out.replace("{{" + key + "}}", str(value))
        left = sorted(set(re.findall(r"\{\{([A-Z_]+)\}\}", out)))
        if left:
            raise SystemExit(f"{rel_path} 还有未替换的占位符：{left}")

        target = DIST / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(out, encoding="utf-8")
        pages += 1

    # 协议页：由 assets/agreements/ 的原文生成，保证与 App 内展示一致。
    legal_tpl = (SITE / "legal.template.html").read_text(encoding="utf-8")
    for slug, meta in LEGAL_DOCS.items():
        md = meta["source"].read_text(encoding="utf-8")
        out = legal_tpl
        for key, value in {
            **common,
            "REL": "",  # 协议页在站点根目录
            "APK_HREF": apk_href,
            "LEGAL_TITLE": meta["title"],
            "LEGAL_SLUG": slug,
            "LEGAL_UPDATED": legal_updated(md),
            "LEGAL_BODY": md_to_html(md),
            "LEGAL_NAV_A": ' aria-current="page"' if slug == "privacy" else "",
            "LEGAL_NAV_B": ' aria-current="page"' if slug == "terms" else "",
            "SITE_NAV": render_side(common, "", ""),
        }.items():
            out = out.replace("{{" + key + "}}", value)
        (DIST / f"{slug}.html").write_text(out, encoding="utf-8")
        pages += 1

    # 栏目邀请页：20 个社区各一页 + 各自图标（须在 copy_assets 之后，
    # 因为 copy_assets 会整个重建 dist/assets/）。
    pages += build_communities(common)

    # 缠论读书会：108 课正文一张静态页。
    pages += build_chan(common)

    # App 内更新检查用的版本信息。
    (DIST / "version.json").write_text(
        json.dumps(
            {
                "version": version,
                "versionCode": version_code,
                "downloadPage": f"{base}/download.html",
                "downloadUrl": apk_url,
                "notes": notes or "",
                "apkSize": apk_size,
                "sha256": common["APK_SHA256"],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    total = len([p for p in DIST.rglob("*") if p.is_file()])
    print(f"输出      {total} 个文件 -> {DIST.relative_to(ROOT)}")
    print(f"          下载直链 {apk_url}")
    print(f"          更新检查 {base}/version.json")

    if args.dry_run:
        print("\n--dry-run：未部署。")
    return DIST


def main() -> int:
    ap = argparse.ArgumentParser(description="构建燃灯官网静态站点")
    ap.add_argument("--notes", help="覆盖本次更新说明，写入 changelog.json")
    ap.add_argument("--apk", help="本次构建用的 APK（默认 site/downloads/huideng.apk）")
    ap.add_argument("--sync", action="store_true", help="只重建站点，不改更新日志")
    ap.add_argument("--dry-run", action="store_true", help="只生成，不部署")
    ap.add_argument("--no-hash", action="store_true", help="跳过 SHA-256 计算（大文件更快）")
    ap.add_argument("--skip-verify", action="store_true", help="跳过 APK versionCode 校验")
    args = ap.parse_args()
    if args.sync and args.notes:
        raise SystemExit("--sync 与 --notes 不能同时用")
    build(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

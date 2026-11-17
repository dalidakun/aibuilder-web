"""校验官网与 App 之间的契约没被改坏（拆分仓库后替代原来的跨仓库 Dart 测试）。

检查三件事：
  1. site/site.config.json 的 baseUrl / siteName / icpNumber / policeRecordNumber
     与 cloudfunctions/api/post_page.js 里的常量一致；
  2. 云函数仍能接住 /post/<id>.html：post_page.js 里有路由正则，
     index.js 里把 /post 交给 postPage.handleHttp；
  3. 可选 --app-repo：20 个栏目 slug 与 App 的 lib/community_invite.dart 一致
     （App 里也有一份 slug 表，新增栏目时两边要同步）。

用法:
  python tools/check_contract.py
  python tools/check_contract.py --app-repo ..\\5-huideng_apk
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
CONFIG = SITE / "site.config.json"
POST_PAGE = ROOT / "cloudfunctions" / "api" / "post_page.js"
INDEX = ROOT / "cloudfunctions" / "api" / "index.js"
COMMUNITIES = SITE / "data" / "communities.json"

failures: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("[OK]   " if ok else "[FAIL] ") + message)
    if not ok:
        failures.append(message)


def js_const(src: str, name: str) -> str | None:
    m = re.search(rf"const\s+{name}\s*=\s*'([^']*)'", src)
    return m.group(1) if m else None


def main() -> int:
    ap = argparse.ArgumentParser(description="检查官网与 App 的契约")
    ap.add_argument("--app-repo", help="App 仓库路径，给了就顺带校验栏目 slug 是否同步")
    args = ap.parse_args()

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    page = POST_PAGE.read_text(encoding="utf-8")
    index = INDEX.read_text(encoding="utf-8")

    check(
        js_const(page, "BASE_URL") == cfg.get("baseUrl"),
        f"post_page.js BASE_URL = {js_const(page, 'BASE_URL')} / site.config baseUrl = {cfg.get('baseUrl')}",
    )
    check(
        js_const(page, "SITE_NAME") == cfg.get("siteName"),
        f"post_page.js SITE_NAME = {js_const(page, 'SITE_NAME')} / site.config siteName = {cfg.get('siteName')}",
    )
    check(
        js_const(page, "ICP_NUMBER") == cfg.get("icpNumber"),
        f"post_page.js ICP_NUMBER = {js_const(page, 'ICP_NUMBER')} / site.config icpNumber = {cfg.get('icpNumber')}",
    )
    police = (cfg.get("policeRecordNumber") or "").strip()
    check(
        (js_const(page, "POLICE_NUMBER") or "") == police,
        f"post_page.js POLICE_NUMBER = {js_const(page, 'POLICE_NUMBER')} / site.config policeRecordNumber = {police}",
    )

    check("/^\\/post(\\.html)?(\\/|$)/" in page, "post_page.js 仍识别 /post/<id>.html")
    check("postPage.handleHttp" in index, "index.js 仍把 /post 请求交给 postPage.handleHttp")

    if args.app_repo:
        app = pathlib.Path(args.app_repo)
        dart = app / "lib" / "community_invite.dart"
        if not dart.is_file():
            check(False, f"找不到 {dart}")
        else:
            src = dart.read_text(encoding="utf-8")
            m = re.search(r"kCommunityInviteSlugs\s*=\s*\{(.*?)\n\};", src, re.S)
            app_slugs = dict(re.findall(r"'([^']+)':\s*'([^']+)'", m.group(1))) if m else {}
            data = json.loads(COMMUNITIES.read_text(encoding="utf-8"))
            web_slugs = {c["name"]: c["slug"] for c in data["communities"]}
            missing = {k: v for k, v in app_slugs.items() if web_slugs.get(k) != v}
            extra = {k: v for k, v in web_slugs.items() if app_slugs.get(k) != v}
            check(
                not missing and not extra,
                f"栏目 slug 与 App 一致（App {len(app_slugs)} 个 / 官网 {len(web_slugs)} 个）",
            )
            if missing:
                print(f"        官网缺或不同：{missing}")
            if extra:
                print(f"        App 缺或不同：{extra}")

    print()
    if failures:
        print(f"有 {len(failures)} 项不一致，改完再发版。")
        return 1
    print("契约检查通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

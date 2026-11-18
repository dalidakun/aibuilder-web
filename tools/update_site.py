"""发布 aibuilder.top 新版：收包 → 写版本信息 → 重建站点 → 部署 → 回源验证。

本仓库独立于 App：APK 由 App 那边 `flutter build apk --release` 打出来后传进来，
不再读 pubspec.yaml、lib/ 或 build/ 目录。

用法:
  python tools/update_site.py --apk ..\\5-huideng_apk\\build\\app\\outputs\\flutter-apk\\app-release.apk --version 3.5.3+39
  python tools/update_site.py --apk <apk> --version 3.5.3+39 --notes "修复……"
  python tools/update_site.py --apk <apk> --version 3.5.3+39 --no-deploy   # 只更新本地站点
  python tools/update_site.py --version 3.5.3+39                            # 复用 site/downloads 里已有的包

做的事情:
  1. 校验 APK 里的 versionCode 与 --version 的 build 号一致
  2. 拷到 site/downloads/huideng.apk（.gitignore 忽略，不入库）
  3. 写 site/release.json，并把这一版插到 site/changelog.json 最前
  4. 调 tools/build_site.py 重建 site/dist
  5. tcb hosting deploy 到根目录（aibuilder.top）和 /huideng 子目录（App 更新检查用）
  6. 回源请求一次线上 APK，确认能下到完整文件
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DIST = SITE / "dist"
CONFIG = SITE / "site.config.json"
RELEASE = SITE / "release.json"
CHANGELOG = SITE / "changelog.json"
DOWNLOADS = SITE / "downloads"
BUILD = ROOT / "tools" / "build_site.py"

sys.path.insert(0, str(ROOT / "tools"))


def _reconfigure() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def human(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def sha256_of(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_version(raw: str) -> tuple[str, int]:
    """`3.5.3+39` → ('3.5.3', 39)。"""
    name, _, build = raw.strip().partition("+")
    if not name or not build.isdigit():
        raise SystemExit(f"--version 要写成 x.y.z+NN，收到：{raw!r}")
    return name, int(build)


def load_json(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: pathlib.Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def take_apk(explicit: str | None) -> pathlib.Path:
    """把 APK 收进 site/downloads/，返回落地后的路径。"""
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    dest = DOWNLOADS / "huideng.apk"
    if explicit:
        src = pathlib.Path(explicit)
        if not src.is_absolute():
            src = pathlib.Path.cwd() / src
        if not src.is_file():
            raise SystemExit(f"APK 不存在：{src}")
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
            print(f"[收包]   {src} -> {dest.relative_to(ROOT)}")
        else:
            print(f"[收包]   复用 {dest.relative_to(ROOT)}")
    elif dest.is_file():
        print(f"[收包]   复用 {dest.relative_to(ROOT)}")
    else:
        raise SystemExit(
            "site/downloads/huideng.apk 不存在，请用 --apk 指定 App 打出来的安装包。"
        )
    return dest


def deploy() -> tuple[int, str]:
    """上传 site/dist，返回 (状态码, 说明)。0=成功 1=失败 2=跳过。"""
    try:
        cfg = load_json(CONFIG)
    except (OSError, json.JSONDecodeError) as e:
        print(f"[部署]   读不到 site.config.json：{e}")
        return 1, "config"

    dep = cfg.get("deploy") or {}
    env_id = dep.get("cloudbaseEnvId")
    cloud_path = dep.get("cloudPath") or ""

    if not env_id:
        print("[部署]   site.config.json 未配置 deploy.cloudbaseEnvId，已跳过。")
        return 2, "未配置"

    tcb = shutil.which("tcb")
    if not tcb:
        print("[部署]   未找到 tcb CLI，已跳过。")
        print("         安装：npm install -g @cloudbase/cli   然后 tcb login")
        return 2, "无 tcb"

    # 两处都要更新：根目录 = aibuilder.top 官网；
    # /huideng 子目录 = App 内硬编码引用的 version.json / download.html。
    targets = [""] + ([cloud_path] if cloud_path else [])
    for target in targets:
        args = [tcb, "hosting", "deploy", str(DIST)]
        if target:
            args.append(target)
        args += ["-e", env_id]
        if tcb.lower().endswith((".cmd", ".bat")):
            args = ["cmd", "/c", *args]

        label = f"/{target}" if target else "/（根目录）"
        print(f"[部署]   tcb hosting deploy {DIST.relative_to(ROOT)} {target} -e {env_id}")
        sys.stdout.flush()
        # 从 GUI（pythonw，无控制台）调用时避免 tcb 弹出黑色控制台窗口；
        # 在终端里运行时输出仍走当前控制台，不受影响。
        run_kwargs = {}
        if sys.platform == "win32":
            run_kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        proc = subprocess.run(args, cwd=str(ROOT), **run_kwargs)
        if proc.returncode != 0:
            print()
            print(f"[部署]   {label} 上传失败。常见原因：")
            print("           未登录 → 先执行 tcb login")
            print("           环境到期 → tcb env list 查看到期时间")
            return 1, "上传失败"
        print(f"[部署]   上传完成：{label}")
    return 0, "已上传"


def verify(cfg: dict) -> int:
    """回源请求一次 APK，确认线上真的能下到完整文件。"""
    base = (cfg.get("baseUrl") or "").rstrip("/")
    apk_url = base + (cfg.get("apkPath") or "/downloads/huideng.apk")
    local = DOWNLOADS / "huideng.apk"
    local_size = local.stat().st_size
    print(f"[验证]   {apk_url}")
    sys.stdout.flush()
    try:
        with urllib.request.urlopen(apk_url, timeout=60) as resp:
            status = resp.status
            length = int(resp.headers.get("Content-Length") or 0)
            ctype = resp.headers.get("Content-Type", "-")
    except urllib.error.HTTPError as e:
        print(f"         HTTP {e.code}  ← 线上不可访问")
        return 1
    except Exception as e:  # noqa: BLE001 - 网络错误种类多，统一给出提示
        print(f"         请求失败：{e}")
        return 1

    ok = status == 200 and length == local_size
    print(f"         HTTP {status}  {length:,} bytes  {ctype}")
    if length == local_size:
        print(f"         与本地一致（{human(local_size)}）")
    else:
        print(f"         与本地不一致（本地 {local_size:,}）← 线上可能是旧包")
    print(f"{'[验证]   通过。' if ok else '[验证]   未通过，请重新部署。'}")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="发布 aibuilder.top 新版（APK + 站点）")
    ap.add_argument("--apk", help="App 打出来的 APK 路径；省略则复用 site/downloads/huideng.apk")
    ap.add_argument("--version", required=True, help="版本号，格式 x.y.z+NN，如 3.5.3+39")
    ap.add_argument("--notes", help="更新说明；省略则沿用它上次的说明")
    ap.add_argument("--date", help="发布日 YYYY-MM-DD，默认今天")
    ap.add_argument("--no-deploy", action="store_true", help="只更新本地站点，不部署")
    ap.add_argument("--skip-verify", action="store_true", help="部署后不回源验证")
    args = ap.parse_args()

    version, version_code = parse_version(args.version)
    release_date = args.date or _dt.date.today().isoformat()

    print("=" * 62)
    print("  aibuilder.top · 发布新版")
    print("=" * 62)
    print()

    apk = take_apk(args.apk)
    st = apk.stat()

    # 校验 APK 的 versionCode，避免把旧包配上新版本号。
    from build_site import apk_version_code  # noqa: E402 - 同目录脚本

    code = apk_version_code(apk)
    if code is not None and code != version_code:
        print(f"[失败]   APK 内 versionCode={code}，与 --version 的 build {version_code} 不一致。")
        print("         请重新打包，或把 --version 改成与 APK 一致的版本。")
        return 1
    if code is None:
        print("[警告]   读不出 APK 的 versionCode，跳过校验。")

    old_release = load_json(RELEASE) if RELEASE.is_file() else {}
    notes = args.notes
    if notes is None:
        notes = (old_release.get("notes") or "").strip()
        if not notes:
            changelog = load_json(CHANGELOG)
            notes = next(
                (r.get("notes", "") for r in changelog.get("releases", []) if r["version"] == version),
                "",
            )

    release = {
        "version": version,
        "versionCode": version_code,
        "releaseDate": release_date,
        "apkFilename": "huideng.apk",
        "apkSize": st.st_size,
        "sha256": sha256_of(apk),
        "notes": notes,
        "_note": "官网发布版本信息。由 tools/update_site.py 写入；单独改页面内容不需要动它。",
    }
    write_json(RELEASE, release)
    print(f"[版本]   v{version} (build {version_code})  {human(st.st_size)}  {release_date}")

    changelog = load_json(CHANGELOG)
    releases = [
        r for r in changelog.get("releases", []) if r.get("version") != version
    ]
    releases.insert(
        0,
        {
            "version": version,
            "versionCode": version_code,
            "date": release_date,
            "notes": notes or "本次更新以修复与体验优化为主。",
        },
    )
    changelog["releases"] = releases
    write_json(CHANGELOG, changelog)
    print("[日志]   已写入 changelog.json")

    print()
    print("[构建]   重建 site/dist ……")
    sys.stdout.flush()
    proc = subprocess.run([sys.executable, str(BUILD), "--sync"], cwd=str(ROOT))
    if proc.returncode != 0:
        print("[失败]   构建失败，站点未更新。")
        return 1

    print()
    cfg = load_json(CONFIG)
    if args.no_deploy:
        print("[部署]   --no-deploy：只更新了本地 site/dist，未上传。")
        return 0

    code, _why = deploy()
    print()
    if code == 2:
        print("[未部署] 本地站点已更新。手动上传：")
        print(f"             tcb hosting deploy site/dist -e {cfg.get('deploy', {}).get('cloudbaseEnvId', '<环境ID>')}")
        return 0
    if code != 0:
        return 1

    if args.skip_verify:
        print("[验证]   --skip-verify：跳过。")
        return 0

    print()
    if verify(cfg) != 0:
        return 1
    print()
    print("[上线]   https://aibuilder.top/")
    print("         CDN 若显示旧页面，等几分钟或用无痕窗口看。")
    return 0


if __name__ == "__main__":
    _reconfigure()
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print()
        raise SystemExit(130)

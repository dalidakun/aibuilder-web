# aibuilder.top 官网

燃灯 App（`huideng`）的官方网站与云函数，**已从 App 仓库拆分出来独立维护**。
本仓库只放官网相关代码，不包含 Flutter App 源码，构建时也不再读 App 的文件。

- 线上地址：<https://aibuilder.top/>
- GitHub：<https://github.com/dalidakun/aibuilder-web>
- CloudBase 环境：`randeng-d8gs968w22a3d98e8`
- 部署位置：静态托管根目录（官网）+ `/huideng` 子目录（App 更新检查与下载页）

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `site/` | 网页源码：页面、样式、脚本、数据 |
| `site/index.html` | 首页（BTC 行情 / 模拟盘），`#app` 是燃灯 App 视图（iframe 到 `site/app/`） |
| `site/download.html`、`site/app/` | 下载页与 App 介绍页 |
| `site/post.html`、`site/note.html`、`site/notes/`、`site/review/`、`site/trade/`、`site/changelog.html` | 分享落地页、交易笔记、复盘、行情子页、更新日志 |
| `site/stocks/`、`site/assets/js/stocks.js`、`site/assets/stocks.css` | 乘法自选（临界点 / 比价关系）独立菜单页，纯前端；320 个行业板块，板块/个股各自选 1 小时 / 日线 / 周线（比价关系下个股周期灰显），固定 MA250，无导出；比价表支持右键置顶/取消置顶/移到底部/移回上方，左侧栏可折叠；个股单击选中、双击弹不复权走势图（临界点含 5 年数据，比价关系仅走势） |
| `site/assets/data/stock-boards.json` | 行业板块静态目录（320 个，无 Key 时兜底） |
| `site/community.template.html` + `site/data/communities.json` | 20 个栏目邀请页（构建时生成 20 页） |
| `site/chan.template.html` + `site/data/chan-lessons.json` | 缠论读书会（108 课） |
| `site/legal.template.html` + `site/data/legal/*.md` | 隐私政策 / 用户协议 |
| `site/site.config.json` | 站点配置：域名、备案号、下载路径、云环境、接口凭证、导航 |
| `site/release.json` | 当前发布的版本信息（版本号 / versionCode / 日期 / 说明 / 包大小与 sha256） |
| `site/changelog.json` | 更新日志数据源 |
| `site/dist/` | 构建产物（已 gitignore，部署的就是它） |
| `site/downloads/` | 待下发的 APK（已 gitignore，发版时拷进来） |
| `cloudfunctions/api/` | 云函数：笔记/帖子/用户、行情、分享落地页（与 App 共用） |
| `tools/build_site.py` | 构建：模板 → `site/dist/`，生成 `version.json` |
| `tools/update_site.py` | 发版：收 APK → 写版本信息 → 构建 → 部署 → 回源验证 |
| `tools/extract_chan.py`、`extract_chan_mobi.py` | 从 Word 抽缠论 108 课到 `site/data/` |
| `tools/site_check.py`、`trade_page_test.js`、`note_api_test.js`、`test-badge-api.js` | 页面 / 接口自检 |
| `docs/` | 官网设计文档 |

## 常用命令

```powershell
# 只改网页：重建 site/dist（不部署）
python tools\build_site.py --sync

# 发新版：App 那边 flutter build apk --release 之后
python tools\update_site.py --apk ..\5-huideng_apk\build\app\outputs\flutter-apk\app-release.apk --version 3.5.3+39 --notes "修复……"

# 也可以把 APK 拖到 tools\update_site.bat 上，或在命令行给 bat 传两个参数

# 只构建、不部署
python tools\update_site.py --apk <apk> --version 3.5.3+39 --no-deploy

# 单独部署静态站（根目录 + /huideng 子目录）
tcb hosting deploy site/dist -e randeng-d8gs968w22a3d98e8
tcb hosting deploy site/dist huideng -e randeng-d8gs968w22a3d98e8

# 部署云函数（改完 cloudfunctions/api 之后）
tcb fn code update api --dir cloudfunctions/api -e randeng-d8gs968w22a3d98e8
```

构建需要本机 Python 3，可选 `Pillow`（页面截图转 JPG）和 `segno`（下载二维码）。
没有也能构建，只是截图不压缩、二维码不生成。

## 内容改在哪里

- 页面文案、导航、备案号、下载路径、云环境：`site/site.config.json`
- 20 个栏目（名称 / slug / 简介 / 正文 / 图标）：`site/data/communities.json` + `site/assets/sect/<slug>.png`
- 隐私政策、用户协议：`site/data/legal/*.md`
- 更新日志：`site/changelog.json`
- 缠论 108 课：`site/data/chan-lessons.json`（`tools/extract_chan.py` 生成）+ `site/assets/chan/`
- 行情 / 交易 / 复盘页：`site/trade/`、`site/index.html`、`site/assets/js/trade.js`
- A股比价页（菜单名「乘法自选」）：`site/stocks/index.html` + `site/assets/{stocks.css,js/stocks.js,data/stock-boards.json}`，
  320 个行业板块、板块 / 个股各自三周期、固定 MA250；空输入算全部板块；比价表右键置顶/取消置顶/移到底部/移回上方；个股单击选中、双击看不复权 1 小时走势（临界点含 5 年数据，比价关系仅走势）；左侧栏可折叠；数据源与缓存见 `docs/A股比价网页版.md`
- 首页左右轨道：`site/index.html` 的 `stocksPane` + `site/assets/js/trade.js` 的 `PANES`（乘法自选作为第四页）
- 顶部导航：`tools/build_site.py` 的 `SIDE_LINKS` / `SIDE_ICONS` / `NAV_CURRENT`（新增页面时三处一起改）

## 与 App 的边界（App 不受影响的关键）

App 只通过**固定 URL** 依赖官网，源码层面不再互相引用：

| App 侧文件 | 依赖的官网地址 |
| --- | --- |
| `lib/update_service.dart` | `https://randeng-d8gs968w22a3d98e8-1461892767.tcloudbaseapp.com/huideng/version.json` |
| `lib/post_share.dart` | `https://aibuilder.top/post/<id>.html` |
| `lib/community_invite.dart` | `https://aibuilder.top/community/<slug>.html`、`/download.html` |
| `lib/cloudbase_config.dart` | 云环境 `randeng-d8gs968w22a3d98e8`（云函数 `api` 与本仓库 `cloudfunctions/api` 是同一套） |

所以：**改网页页面、样式、文案、数据，不会影响 App。** 但下面这些是双方契约，改之前要两边一起动：

1. 域名 `aibuilder.top`、路径 `/post/`、`/community/`、`/download.html`；
2. `/huideng/version.json` 的字段（`version`、`versionCode`、`downloadUrl`、`notes`、`apkSize`、`sha256`）；
3. 云函数 `api` 的 action 入参与返回结构（App 和网页都调它）；
4. 云环境 `envId` / `accessKey`（App 在 `lib/cloudbase_config.dart`，本仓库在 `site/site.config.json` 的 `api` 段）；
5. 20 个栏目的 slug：App 的 `lib/community_invite.dart` 里也有一份，新增或改名栏目要两边同步。

## 从 App 仓库拆出来的说明

拆分前这些内容都在 `E:\5-huideng_apk`（仓库 `huideng`）里，`tools/build_site.py`
会直接解析 App 的 `lib/*.dart` 和 `pubspec.yaml`。拆分时做了两件事：

1. 把构建期依赖落成数据：`site/data/communities.json`、`site/assets/sect/`、
   `site/data/legal/`，云配置写进 `site/site.config.json`；
2. 版本号 / APK 不再读 `pubspec.yaml` 和 `build/`，改由 `site/release.json` +
   `site/downloads/huideng.apk` 提供，发版时用 `tools/update_site.py --apk ... --version ...` 写入。

App 仓库里的 `site/`、`cloudfunctions/`、官网脚本和文档已经删除，只在 README 里留了指向本仓库的说明。
Git 历史仍保留在 `huideng` 仓库里，需要查旧提交可以去那边看。

## 部署注意

- `site/dist/` 会整体上传到根目录与 `/huideng`，根目录的 `__auth/` 等系统文件不在 dist 里，不会被覆盖。
- 批量上传偶尔会漏首页 / 入口文件，遇到线上没更新时单独再传一次：
  `tcb hosting deploy site/dist/index.html index.html -e randeng-d8gs968w22a3d98e8`
- CDN 有几分钟缓存，发版后可以用无痕窗口确认。
- APK 30MB+，不要提交进 git；`site/downloads/` 已在 `.gitignore` 里。

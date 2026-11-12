# OIer Coach · 信奥教练与学生榜

从公开竞赛成绩出发，查找选手与教练，了解他们的指导关系与历年表现。

[访问网站](https://oier.kdtree.xyz) · [教练榜](https://oier.kdtree.xyz/rankings/coaches) · [学生榜](https://oier.kdtree.xyz/rankings/students)

OIer Coach 面向 OI 学生、教练和爱好者，提供教练榜、学生榜与可相互跳转的人物档案。项目基于 OIerDB 数据和公开比赛名单，保留资料出处，欢迎大家一起补充与修订。

## 你可以在这里做什么

- 按姓名、拼音首字母或省份查找教练和学生。
- 浏览当前榜与巅峰榜，查看历年名次、比赛成绩和指导贡献。
- 在人物预览中切换师生档案，按学年核对指导关系。
- 使用浅色或深色主题，在电脑和手机上浏览。

## 一起参与

如果项目对你有帮助，欢迎 **Star** 支持，或把仓库分享给身边的 OIer。

发现成绩、身份或指导关系有误，可以提交 Issue 并附上公开证据。希望直接补充资料或改进代码，可以阅读贡献指南并提交 PR。

[项目仓库](https://github.com/LimLi0930/oier-coach) · [反馈问题](https://github.com/LimLi0930/oier-coach/issues) · [贡献指南](CONTRIBUTING.md)

排名根据现有收录资料计算，缺失资料会逐步补全。感谢 OIerDB 项目以及历届比赛名单和资料的整理者。

## 本地运行

需要 Node.js 24 和 Python 3.11 以上版本，当前验证环境为 Python 3.14。

```sh
npm ci
python -m pip install -r requirements.txt
npm run data
npm run dev
```

打开终端输出的本地地址。首页可切换教练与学生搜索，支持姓名和拼音首字母前缀，停止输入 250ms 后自动搜索，兼容中文输入法。结果按当前全国名次排序，同名次按姓名拼音与稳定 ID 排序，待补充积分的档案置后。省份、对象和分页保存在 URL 中。空白搜索展示起始页。

教练榜位于 `/rankings/coaches`，学生榜位于 `/rankings/students`，各自支持当前榜、巅峰榜和省份筛选。学生地区匹配任一历史参赛省份，筛选后显示全国名次。详情路径为 `/coach/:id` 与 `/student/:id`，师生姓名可双向跳转。省份和年份使用 Radix 自绘选择控件，名次曲线支持悬停、键盘和触屏选年。

搜索与榜单人物链接先打开预览，桌面使用居中弹窗，手机使用底部抽屉。预览中的关联姓名可切换人物并返回上一位，叠卡动画支持减少动态效果设置。完整主页的返回操作恢复原筛选、分页、浮窗和滚动位置。按住 Ctrl／Command 点击人物链接可在新标签页打开主页。

省份支持中文、全拼和首字母输入，确认候选后应用筛选。顶部主题入口提供跟随系统、浅色和深色，保存本地偏好。页面采用黑白灰为主的语义颜色，B2 图标在两种主题下自动适配，短页面页脚贴合视口底部。

前端通过 URL 的 `preview=student:oier-UID` 或 `preview=coach:coach-ID` 表示预览人物，通过路由状态保存来源和预览栈。滚动位置按浏览器历史记录存入 sessionStorage，主题选择存入 localStorage。首次访问公告说明 CSP-J／S 未收录、计分方式和资料修订入口，阅读状态按公告版本保存在 localStorage，页脚可重新打开。

## 校验与生产构建

```sh
npm run build
npm test
npm run preview -- --port 4173
```

另一个终端运行浏览器测试。Windows 使用已安装的 Edge，Linux 使用 Playwright Chromium。

```sh
# Linux 首次使用
npx playwright install --with-deps chromium
TEST_URL=http://127.0.0.1:4173 npm run test:ui
```

PowerShell 使用 `$env:TEST_URL='http://127.0.0.1:4173'` 后运行 `npm run test:ui`。

生成的 `dist/` 包含前端和当前数据版本。两类紧凑查询目录在进入站点后预加载，下载期间显示进度，按数据版本写入浏览器 Cache Storage。目录包含人物基础信息、代表学生和历学年教练摘要，人物浮窗可直接在本地查询。完整成绩在进入主页后按需获取，历史曲线已有的人数信息直接复用。缓存受限时自动回退网络加载。构建过程校验固定基线的哈希，原始 SQLite 和抓取缓存保留在本地数据目录。

## 数据结构

- `data/baseline/` 保存固定版本压缩基线及来源、哈希清单，适合随 Git 仓库提交。解压后包含清洗结果与完整上游比赛基准。
- `data/curated/coaches.json` 保存持久教练 ID、展示名称、地区、拼音及身份别名。
- `data/curated/corrections.json` 保存 PR 修订。
- `scripts/build_site_data.py` 负责 UID 匹配、归属、年度回算和分片输出。
- `scripts/scoring.py` 复现固定上游排名系数与年份因子，本站 v3 使用 IOI 权重 1，NOI 正式赛与夏令营／D 类权重均为 0.7。
- `src/types.ts` 定义公开数据模型。
- `public/data/manifest.json` 指向完整生成的数据版本。版本目录中的 `review.json` 保存待核对事项，`sources.json` 保存来源清单。
- 版本目录中的 `coverage.json` 按年份、赛事和学段核对全部成绩的教师证据、归属与计分覆盖率。统计以去重后的考试记录为单位。
- `coaches-directory.json`、`students-directory.json` 为列式紧凑查询包，包含浮窗师生摘要，显示分值保留两位小数。完整精度的排名计算与原始索引保存在原有输出中。版本清单提供目录文件名与解压后字节数，生产包附带 gzip 文件。
- `coaches.json`、`students.json` 分别为两类人物索引，`coaches/`、`students/` 保存逐人详情，`rankings/`、`student-rankings/` 保存年度排名。清单中的 `studentIndex`、`studentYears`、`studentProvinces` 为学生数据入口。
- 学生榜覆盖本站赛事范围内的全部选手。本人积分按有效考试去重求和，缺少教练归属的成绩也计分，多教练关系每场只增加一次学生积分。两类人物分别从最早可计分年份回算历史。

2023 年 NOI 夏令营的 128 条教师名单由公开保存的名单图片逐行转录，并与固定上游名单交叉匹配，修订保存在 `data/curated/corrections.json`。五张原图保存在 `data/baseline/evidence/`，来源 URL、图像哈希及行号保留在每条证据中。

常规构建使用本地固定基线。维护者重新运行抓取及清洗后，可用 `python scripts/freeze_baseline.py --as-of YYYY-MM-DD` 显式更新基线，再运行 `python scripts/build_site_data.py --update-registry` 登记新教练，并审查差异。省略日期参数时采用当天 UTC 日期。

补充教师名单时可使用 `python scripts/freeze_baseline.py --evidence-only --as-of YYYY-MM-DD` 更新清洗证据。`scripts/collect_noi_supplementary.py` 可补采曾遗漏的 NOI 夏令营／邀请赛名单；采集与清洗工具另需安装 requests 和 beautifulsoup4。

## 数据修订

归属使用 `school-year-chronological-v2` 规则。同一学生、同一学年、同一省份内按 NOIP → WC → APIO → NOI → IOI 的赛事顺序处理，缺少教练的比赛沿用此前最近一次明确填写的完整名单。新名单更新后续继承依据，每场明确列名的教师各获全额贡献。并行类别按同一时间处理，最近名单不完整或同场来源冲突时等待核对。每条自动归属记录保存最近名单的记录 ID，禁止向前或跨学年传播。学年以秋季开始年表示，NOIP 2025 与 IOI 2026 同属 2025 学年。公开指导记录包含 `schoolYear`，版本清单包含 `attributionVersion`。

具体格式与示例见 [贡献指南](CONTRIBUTING.md)。教练总分、学生贡献及成绩明细共用同一份未舍入十进制贡献。当前榜同分采用 1、1、3，巅峰榜取年度最佳名次及首次达到的年份。

历史榜使用现有收录资料回算。来源资料可在后续补录，自动归属仅引用比赛顺序中更早的明确名单，年度积分只使用截至当年的赛事。未唯一匹配身份或完整教师集合的成绩保留待核对状态。学生数按独立身份档案统计，待核对身份暂分别保留。

## 发布

复制 `.env.example` 为 `.env.local` 并填入 `VITE_GITHUB_REPOSITORY` 后重新构建。GitHub Actions 会自动使用当前仓库地址，并上传 `dist/` 部署包及浏览器检查报告。

Linux 服务器部署方法见 [部署说明](deploy/README.md)。部署采用版本目录和原子符号链接切换，保留上一版本用于回滚。

## 许可与致谢

项目代码使用 AGPL-3.0。上游算法、数据快照与原始名单的出处见 [第三方说明](THIRD_PARTY.md)、固定基线和生成数据中的来源清单。界面将计分说明集中到规则页，将修订入口集中到贡献页，原始归属证据保存在构建数据与 GitHub 存档中。

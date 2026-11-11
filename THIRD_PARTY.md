# 第三方来源与许可

## OIerDB

积分的 401 档系数、取整、年份因子和赛事权重适配自 OIerDb-ng/OIerDb，固定提交为 `e104eb6da5f9509beceb563e92257ec5d314bc66`。原作者为 OIerDB contributors，许可为 AGPL-3.0，全文保存在仓库 `LICENSE`。

本项目在上游计分基础上增加教练归属、核心赛事范围、阶段贡献、历史名次和待核对状态。本站 v3 计分使用 IOI 权重 1，NOI 正式赛与夏令营／D 类统一使用 0.7，其他已采用赛事的权重沿用固定上游版本。上游 UID 快照独立固定为 `data/baseline/manifest.json` 中的静态数据与选手数据 SHA-512。它们的抓取地址、解压后 SHA-256 与长度均记录在清单中。

上游源代码及许可证可在项目仓库查看。[OIerDB 源码](https://github.com/OIerDb-ng/OIerDb/tree/e104eb6da5f9509beceb563e92257ec5d314bc66) · [许可证](https://github.com/OIerDb-ng/OIerDb/blob/e104eb6da5f9509beceb563e92257ec5d314bc66/LICENSE)

## 原始名单

全国赛事、地区主办方、学校、媒体及社区来源保留原链接和类型。数据基线中的 `sources.json.gz` 记录来源清单，各条成绩保留对应来源 ID 与教师原文，构建数据保存完整证据链。原始名单与报道内容的权利归各发布者，代码许可证适用于本项目代码。

## 字体与图标

Source Sans 3 通过 `@fontsource/source-sans-3` 本地打包，许可为 SIL Open Font License 1.1。Lucide 图标由 `lucide-react` 提供，使用 ISC 许可。React、Vite、TypeScript、Decimal.js 和 React Router 的依赖许可随各 npm 包提供，精确版本记录于 `package-lock.json`。

## 选择控件

自绘下拉使用 Radix Select 的无样式组件，版权属于 WorkOS，采用 MIT 许可。生产包的 `licenses/Radix-Select-MIT.txt` 保存许可全文，精确依赖版本记录于 `package-lock.json`。

人物预览使用 Radix Dialog，省份候选及主题菜单使用 Radix Popover，均采用 MIT 许可。生产包分别保存对应许可全文。

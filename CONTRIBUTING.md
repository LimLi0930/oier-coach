# 数据修订

每次 PR 描述修改对象、原因和可访问的原始证据。构建会保留原始名单，同时应用可审查的修订。构建输出的成绩 JSON 保存记录 ID、来源与证据，页面通过贡献入口指引修订。

## 教练身份

`data/curated/coaches.json` 中每项包含 `id`、`name`、`province`、`initials`、`keys`。`keys` 是原始规范化姓名和省份的匹配键。修改展示名称或地区时保留 `id` 和原有匹配键，添加新的匹配键。`redirectIds` 可以保留合并前档案的链接。

同省同名按已确定的口径合并，学校仅作为来源和选手匹配信息。特殊同名拆分可创建独立 ID，并通过逐场修订指定实际教练。新来源带来新教练时运行 `python scripts/build_site_data.py --update-registry`，将新增注册表条目一并提交。

## 修订文件

`data/curated/corrections.json` 的修订数组接受下列格式。示例 ID 使用实际输出格式，示例 URL 需要替换为证据地址。

### 选手身份

`identities` 指定某条清洗结果对应的 OIerDB UID。清洗结果 ID 可从成绩详情 JSON 的 `originIds` 取得。身份匹配会再次寻找该 UID 同年同类赛事的实际记录，缺少比赛基准时保留待计分荣誉。

```json
{
  "resultId": "清洗结果的原始ID",
  "uid": 86883,
  "sources": ["https://原始证据地址"],
  "reason": "比赛、学校与年级交叉核对确认身份"
}
```

### 指导学年范围

`guidance` 用于补充或澄清指导学年范围。自动归属按同一学生、同一学年和同一省份中此前最近一场完整名单补齐，赛事顺序采用 NOIP → WC → APIO → NOI → IOI。新填写名单更新后续继承依据。缺少此前证据或同场来源冲突时，可以通过这里指定明确范围。学年以秋季开始的自然年表示，范围包含两端。例如 2024 学年覆盖 NOIP 2024 和 WC、APIO、NOI、IOI 2025。这里的教师只补齐缺少明确名单的比赛，逐场更正使用 `results`。

```json
{
  "studentId": "oier-86883",
  "stage": "senior",
  "province": "重庆",
  "fromSchoolYear": 2024,
  "toSchoolYear": 2025,
  "coachIds": ["coach-3369e254b0905d23"],
  "sources": ["https://原始证据地址"],
  "reason": "已核对该学年指导关系"
}
```

`stage` 支持 `primary`、`junior`、`senior`。同一学生、学段、省份和学年范围内的冲突教师集合会使构建失败。

### 逐场归属修正

`results` 可以使用网站成绩 ID 或清洗结果 ID。`coachIds` 是更正后的完整集合，空数组表示明确撤销该场全部归属。`eligible` 可选，设为 `false` 表示取消资格，设为 `true` 可恢复已确认资格并重新计算。`grade` 可补充或修正标准年级，`schoolYear` 可修正学年。修订仍需保留证据和说明。

```json
{
  "resultId": "oier-86883-比赛编号",
  "coachIds": ["coach-3369e254b0905d23"],
  "sources": ["https://原始证据地址"],
  "reason": "原名单归属更正说明"
}
```

### 新增名单成绩

`additionalResults` 接受清洗结果格式，并参与相同的上游匹配与去重流程。每条提供唯一 `result_id`，主榜记录用 `variant=main`，NOIP 分组用 `提高组`、`普及组` 或 `统一组`，其他比赛的 `group` 为空。新增来源登记在修订文件的 `sources` 数组中，每项包含唯一 `id`、HTTP(S) `url` 和来源 `type`，例如 `school_report`。

```json
{
  "result_id": "pr-唯一标识",
  "event": "NOI",
  "year": 2025,
  "variant": "main",
  "group": "",
  "student": "学生姓名",
  "province": "重庆",
  "school": "名单学校原文",
  "grade": "高一",
  "award": "金牌",
  "score": "624",
  "eligibility": "listed",
  "coach_names": ["黄新军"],
  "coach_status": "parsed",
  "source_ids": ["pr-source-唯一标识"],
  "coach_evidence": [{
    "raw": "黄新军",
    "names": ["黄新军"],
    "unresolved": [],
    "source_id": "pr-source-唯一标识",
    "observation_id": "pr-observation-唯一标识"
  }]
}
```

新增记录的年级应为标准明确学段。匹配到的上游记录已有明确年级时保留上游年级，学段冲突会进入待核对。完整教师名单的 `coach_evidence` 可保存 `raw`、`names`、`unresolved`、`source_id` 和 `observation_id`，供后续追溯。

## 提交前验证

```sh
npm run build
npm test
```

启动预览后运行 `npm run test:ui`。检查目标教练主页、展开学生成绩与归属证据。榜单及历史由构建重算，生成的 `public/data/` 已由 Git 忽略。

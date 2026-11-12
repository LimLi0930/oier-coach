import { repositoryUrl } from "../data";
import { External } from "../components/ui";

export function RulesPage() {
  return (
    <article className="reading-page">
      <div className="page-heading">
        <div>
          <h1>计分与排名规则</h1>
          <p>理解每一场成绩的贡献。</p>
        </div>
      </div>
      <section className="surface prose">
        <h2>赛事与积分</h2>
        <p>
          <strong>本站未收录 CSP-J、CSP-S，相关成绩不参与本站排名。</strong>
        </p>
        <p>
          教练榜和学生榜使用同一套单场积分规则。计分赛事包括 NOI
          正式赛、夏令营／D 类、NOIP、WC 常规组、APIO 常规类别及
          IOI。小学、初中和高中的有效成绩均可计分。
        </p>
        <div className="formula">
          1.25<sup>比赛年份 − 2000</sup> × 排名系数 × 赛事权重
        </div>
        <table className="weight-table">
          <thead>
            <tr>
              <th>赛事</th>
              <th>权重</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["IOI", "1"],
              ["NOI", "0.7"],
              ["NOI 夏令营／D 类", "0.7"],
              ["WC", "0.5"],
              ["APIO", "0.4"],
              ["现行 NOIP", "0.15"],
              ["旧 NOIP 提高组", "0.1"],
              ["旧 NOIP 普及组", "0.06"],
            ].map(([name, weight]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          排名系数沿用 OIerDB 的 401 档数组，按名次与完整赛事人数计算。例如 NOIP
          2025 的人数基准为 7,548，rk1 的系数为 100，rk50 为
          98。夏令营的金、银、铜级别对应官方公布的奖牌分数线。
        </p>
        <p>
          计算使用 64
          位有效数字的十进制精度，排名依据未舍入积分，页面显示两位小数。线上体验和
          AI 组作为附属成绩展示。
        </p>
        <h2>学生与教练贡献</h2>
        <p>
          学生总分按本人有效成绩去重求和，每场比赛计算一次。教师关系待补充的成绩也参与学生计分。
        </p>
        <p>
          名单明确列出的指导教师各获得该场全额贡献。同一学生、同一学年和同一省份内，缺少教练名单的比赛沿用此前最近一场明确填写的完整名单。每次出现新名单，从该场开始更新继承依据。
        </p>
        <p>
          本站按学年内 NOIP → WC → APIO → NOI → IOI 的赛事顺序处理。例如 NOIP
          2025 与 WC、APIO、NOI、IOI 2026 同属 2025 学年，IOI
          缺少名单时优先沿用此前的 NOI
          名单。同场不同类别按同一时间处理。学年早期尚无名单、最近名单不完整、同场来源有冲突或身份待核对时，缺失归属等待补充。
        </p>
        <p>
          教练按规范化姓名与省份汇总，同省同名的跨学校、跨校区记录进入同一档案。选手优先对应
          OIerDB UID。身份和计分资料明确后参与排名，待核对档案可以搜索查看。
        </p>
        <h2>当前榜与巅峰榜</h2>
        <p>
          当前榜累加全部有效贡献，历届选手和退休教练同样参与。同分采用 1、1、3
          的并列名次。地区筛选展示全国名次，学生可以在任一历史参赛省份中被找到。
        </p>
        <p>
          历年排名按自然年回算，每年使用当年及以前的成绩。巅峰名次取历史最好名次，并记录首次达到的年份及当年排名人数。同一巅峰名次并列，展示顺序按当前名次和稳定身份排序。
        </p>
        <p>
          历史排名依据现有收录资料计算，数据修订后重新生成。完整计算代码与资料修订方式可通过页脚入口查看。
        </p>
      </section>
    </article>
  );
}

export function ContributePage() {
  return (
    <article className="reading-page">
      <div className="page-heading">
        <div>
          <h1>一起完善教练与学生档案</h1>
          <p>从一份可核验的名单开始。</p>
        </div>
      </div>
      <section className="surface prose">
        <h2>项目已在 GitHub 开源</h2>
        <p>
          OIer Coach
          将公开比赛成绩与师生指导关系整理成可检索的档案。你可以查看计分实现、提出使用建议，或和我们一起补全缺失资料。如果项目对你有帮助，欢迎在
          GitHub 点一颗 Star。
        </p>
        {repositoryUrl && (
          <div className="community-links">
            <External className="button primary" href={repositoryUrl}>
              查看项目与 Star
            </External>
            <External className="button" href={`${repositoryUrl}/issues/new`}>
              反馈问题
            </External>
            <External
              className="button"
              href={`${repositoryUrl}/blob/main/CONTRIBUTING.md`}
            >
              贡献指南
            </External>
          </div>
        )}
        <h2>补充与修订资料</h2>
        <p>
          可以补充姓名与拼音、学生身份、指导学年，以及具体比赛的教练归属。请提供公开名单或学校报道的链接，并说明修改原因。
        </p>
        <ol>
          <li>在项目仓库中查找需要修订的人物与比赛。</li>
          <li>按贡献指南提交资料更正和证据。</li>
          <li>通过 Pull Request 检查，重新生成相关档案与榜单。</li>
        </ol>
        {repositoryUrl ? (
          <External className="button primary" href={`${repositoryUrl}/pulls`}>
            前往 GitHub 提交修订
          </External>
        ) : (
          <p className="configuration-note">GitHub 仓库地址待配置</p>
        )}
        <h2>关于 OIer Coach</h2>
        <p>
          面向 OI 学生、教练与爱好者，整理公开比赛资料中的成绩与指导关系。感谢
          OIerDB 项目及历届比赛资料的整理者。
        </p>
        <p>
          项目代码采用 AGPL-3.0
          许可。数据证据、计算实现和贡献指南随项目源码提供。
        </p>
      </section>
    </article>
  );
}

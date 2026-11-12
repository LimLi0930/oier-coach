import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { External } from "./ui";
import { repositoryUrl } from "../data";
import { Link } from "react-router-dom";

export const noticeVersion = "2026-11-csp-scoring-v2";
export const noticeStorageKey = "oier-coach-notice";
export function noticeWasRead() {
  try {
    return localStorage.getItem(noticeStorageKey) === noticeVersion;
  } catch {
    return false;
  }
}
export function rememberNotice() {
  try {
    localStorage.setItem(noticeStorageKey, noticeVersion);
  } catch {
    /* Acknowledgement still closes this visit's notice. */
  }
}
export function SiteNotice({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="preview-overlay" />
        <Dialog.Content
          className="site-notice"
          aria-describedby="site-notice-intro"
        >
          <div className="notice-header">
            <Dialog.Title>欢迎使用 OIer Coach</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="关闭公告">
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          <div className="notice-body">
            <p id="site-notice-intro">
              首次访问，请先了解本站的收录与计分方式。
            </p>
            <p className="notice-disclaimer">
              仅供参考娱乐，不构成实际对比和意见
            </p>
            <section className="notice-scope">
              <h3>本站未收录 CSP-J／S</h3>
              <p>
                CSP-J、CSP-S 的成绩不进入本站档案和积分。当前计分赛事为 NOI
                正式赛及夏令营／D 类、NOIP、WC 常规组、APIO 常规类别和 IOI。
              </p>
            </section>
            <section>
              <h3>积分如何计算</h3>
              <p className="notice-formula">
                单场积分 = 1.25<sup>比赛年份 − 2000</sup> × 排名系数 × 赛事权重
              </p>
              <p>
                排名系数沿用 OIerDB 的 401 档规则，依据赛事名次和人数计算。IOI
                权重为 1，NOI 及夏令营／D 类为 0.7，WC 为 0.5，APIO 为 0.4，现行
                NOIP 为 0.15，旧提高组为 0.1、普及组为 0.06。
              </p>
              <p>
                学生积分按有效考试去重求和。明确列名的教练各获得全额贡献。缺少名单时，同一学生、学年与省份内按赛事时间顺序沿用此前最近的完整教练名单。IOI
                所在学年缺少可用名单时，沿用该选手同省份最近一届此前 NOI
                的明确名单。当前榜累计全部有效贡献，巅峰榜取历年最佳名次。
              </p>
              <Link to="/rules" onClick={onClose}>
                查看完整计分规则
              </Link>
            </section>
            <section>
              <h3>资料可能存在缺失，欢迎补充</h3>
              <p>
                官方公开名单可能缺少教练、年级或其他信息，历史资料也可能不完整。本站保留待补充、待核对状态，榜单会随资料修订重新计算。
              </p>
              <p>
                欢迎附上官方名单、学校报道等公开证据，通过 GitHub 提交 PR
                补充或纠正资料。
              </p>
              {repositoryUrl ? (
                <External href={`${repositoryUrl}/blob/main/CONTRIBUTING.md`}>
                  阅读贡献指南并提交 PR
                </External>
              ) : (
                <Link to="/contribute" onClick={onClose}>
                  查看资料修订说明
                </Link>
              )}
            </section>
          </div>
          <div className="notice-footer">
            <button className="button primary" onClick={onClose}>
              我已了解，开始使用
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

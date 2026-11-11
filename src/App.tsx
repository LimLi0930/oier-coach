import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Github } from "lucide-react";
import { repositoryUrl, useResource } from "./data";
import type { Manifest } from "./types";
import { External, LoadState, NotFound } from "./components/ui";
import SearchPage from "./pages/SearchPage";
import RankingsPage from "./pages/RankingsPage";
import CoachPage from "./pages/CoachPage";
import StudentPage from "./pages/StudentPage";
import { ContributePage, RulesPage } from "./pages/InfoPages";
import { PageTransition } from "./components/PageTransition";
import { PersonPreview } from "./components/PersonPreview";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { ScrollRestoration } from "./navigation";
import coachLogo from "./assets/coach-logo.png";

function MainNavigation() {
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
    visible: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const element = nav.current!;
    let active = true;
    function measure() {
      if (!active) return;
      const link = element.querySelector<HTMLElement>('[aria-current="page"]');
      setIndicator((previous) => {
        const next = link
          ? { left: link.offsetLeft, width: link.offsetWidth, visible: true }
          : previous && { ...previous, visible: false };
        return previous?.left === next?.left &&
          previous?.width === next?.width &&
          previous?.visible === next?.visible
          ? previous
          : next;
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts.ready.then(measure);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [pathname]);
  return (
    <nav ref={nav} aria-label="主导航">
      <NavLink to="/" end>
        搜索
      </NavLink>
      <NavLink to="/rankings/coaches">教练榜</NavLink>
      <NavLink to="/rankings/students">学生榜</NavLink>
      <span
        className="nav-indicator"
        aria-hidden="true"
        style={{
          transform: `translateX(${indicator?.left ?? 0}px)`,
          width: indicator?.width ?? 0,
          opacity: indicator?.visible ? 1 : 0,
        }}
      />
    </nav>
  );
}

export default function App() {
  const manifest = useResource<Manifest>("/data/manifest.json");
  const location = useLocation();
  useEffect(() => {
    if (!/^\/(coach|student)\//.test(location.pathname))
      document.title = "OIer Coach · 信奥教练与学生榜";
  }, [location.pathname]);
  return (
    <PersonPreview manifest={manifest.data}>
      <ScrollRestoration />
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="nav-inner">
          <Link className="wordmark" to="/" aria-label="OIer Coach 首页">
            <img
              className="brand-symbol"
              src={coachLogo}
              alt=""
              width={32}
              height={32}
            />
            <span>
              OIer <b>Coach</b>
            </span>
          </Link>
          <div className="header-actions">
            <MainNavigation />
            {repositoryUrl && (
              <a
                className="github-nav"
                href={repositoryUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub 项目仓库"
                title="GitHub 项目仓库"
              >
                <Github size={19} aria-hidden="true" />
              </a>
            )}
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <PageTransition>
        {(routeLocation, current) => (
          <>
            <main id={current ? "main" : undefined} tabIndex={-1}>
              {manifest.data ? (
                <Routes location={routeLocation}>
                  <Route
                    path="/"
                    element={<SearchPage manifest={manifest.data} />}
                  />
                  <Route
                    path="/rankings/coaches"
                    element={
                      <RankingsPage
                        key="coaches"
                        entity="coaches"
                        manifest={manifest.data}
                      />
                    }
                  />
                  <Route
                    path="/rankings/students"
                    element={
                      <RankingsPage
                        key="students"
                        entity="students"
                        manifest={manifest.data}
                      />
                    }
                  />
                  <Route
                    path="/coach/:id"
                    element={<CoachPage manifest={manifest.data} />}
                  />
                  <Route
                    path="/student/:id"
                    element={<StudentPage manifest={manifest.data} />}
                  />
                  <Route path="/rules" element={<RulesPage />} />
                  <Route path="/contribute" element={<ContributePage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              ) : (
                <>
                  <h1 className="loading-title">OIer Coach</h1>
                  <LoadState error={manifest.error} retry={manifest.retry} />
                </>
              )}
            </main>
            <footer className="site-footer">
              <div>
                <strong>OIer Coach</strong>
                <span>信奥教练与学生榜</span>
              </div>
              <div className="footer-links">
                <Link to="/rules">计分规则</Link>
                <Link to="/contribute">参与修订</Link>
                {repositoryUrl && (
                  <External href={repositoryUrl}>GitHub 源码</External>
                )}
                <External href="https://oier.baoshuo.dev/">OIerDB</External>
              </div>
            </footer>
          </>
        )}
      </PageTransition>
    </PersonPreview>
  );
}

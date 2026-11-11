# Linux 自有服务器部署

将域名解析到服务器，并准备 Nginx 与 HTTPS 证书。默认站点目录为 `/srv/oier-coach`，可通过 `SITE_ROOT` 指定专用绝对路径。

## 发布目录

```text
/srv/oier-coach/
  releases/<发布时间>-<数据版本>/
  current -> releases/当前版本/
  previous -> releases/上一版本/
```

从 GitHub Actions 下载 `oier-coach-site` 部署包，解压到服务器暂存目录，再执行发布脚本。也可上传本地 `npm run build` 生成的 `dist/`。

```sh
SITE_ROOT=/srv/oier-coach bash deploy/release.sh /absolute/path/to/dist
```

发布脚本在完成复制后原子切换 `current`，使用文件锁串行化发布。旧版本目录保留，原有浏览器会话需要的旧数据和资源也保留在新版本内。

## Nginx 与 HTTPS

模板的域名和目录由发布者填写。HTTPS 证书路径按 Let's Encrypt 标准位置配置，可按实际证书路径调整。

```sh
export DOMAIN=你的域名
export SITE_ROOT=/srv/oier-coach
envsubst '${DOMAIN} ${SITE_ROOT}' < deploy/nginx.conf.template > /tmp/oier-coach.conf
sudo install -m 644 /tmp/oier-coach.conf /etc/nginx/conf.d/oier-coach.conf
sudo nginx -t
sudo systemctl reload nginx
```

模板让教练详情深链回退到 `index.html`。数据清单与 HTML 每次重新验证，版本数据和哈希资源可长期缓存。JSON 文件不存在时返回 404，前端显示可重试的错误状态。

GitHub 仓库地址在构建时通过 `VITE_GITHUB_REPOSITORY=https://github.com/所有者/仓库` 配置。GitHub Actions 已自动设置为当前仓库。该配置会出现在网页中，应填写公开仓库地址。

## 回滚

```sh
SITE_ROOT=/srv/oier-coach bash deploy/rollback.sh
```

回滚脚本交换 `current` 与 `previous`。再次执行可以切回刚才的版本。完成后验证首页、教练深链、年份选择和数据清单。

服务器地址、域名、证书和仓库地址由实际发布环境提供。本地实现阶段以生产构建与浏览器验收作为验证范围。

构建与 Actions 配置参考官方文档。[Vite 静态部署](https://vite.dev/guide/static-deploy.html) · [GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions)

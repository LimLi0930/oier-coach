#!/usr/bin/env bash
set -euo pipefail
site_root="$(realpath -m "${SITE_ROOT:-/srv/oier-coach}")"
[[ "$site_root" != / && "$site_root" != /srv ]] || exit 1
exec 9>"$site_root/.release.lock"
flock -x 9
previous="$(readlink -f "$site_root/previous")"
current="$(readlink -f "$site_root/current")"
[[ "$previous" == "$site_root/releases/"* && "$current" == "$site_root/releases/"* && -f "$previous/index.html" ]] || { echo 'No valid previous release' >&2; exit 1; }
# Keep resources requested by tabs opened before this rollback available.
cp -an "$current/data/." "$previous/data/"
cp -an "$current/assets/." "$previous/assets/"
ln -sfn "$previous" "$site_root/.current-next"
mv -Tf "$site_root/.current-next" "$site_root/current"
ln -sfn "$current" "$site_root/.previous-next"
mv -Tf "$site_root/.previous-next" "$site_root/previous"
printf 'Rolled back to %s\n' "$previous"

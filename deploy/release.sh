#!/usr/bin/env bash
set -euo pipefail

site_root="$(realpath -m "${SITE_ROOT:-/srv/oier-coach}")"
source_dir="$(realpath "${1:?Usage: bash deploy/release.sh /absolute/path/to/dist}")"
[[ "$site_root" != / && "$site_root" != /srv ]] || { echo 'Choose a dedicated site directory' >&2; exit 1; }
[[ -f "$source_dir/index.html" && -f "$source_dir/data/manifest.json" ]] || { echo 'Incomplete build output' >&2; exit 1; }
mkdir -p "$site_root/releases"
exec 9>"$site_root/.release.lock"
flock -x 9
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$source_dir/data/manifest.json")"
[[ "$version" =~ ^[a-f0-9]{16}$ ]] || { echo 'Invalid data version' >&2; exit 1; }
release_id="$(date -u +%Y%m%dT%H%M%S%NZ)-$version"
release_dir="$site_root/releases/$release_id"
mkdir "$release_dir"
cp -a "$source_dir/." "$release_dir/"

old_release=''
if [[ -L "$site_root/current" ]]; then
    old_release="$(readlink -f "$site_root/current")"
elif [[ -e "$site_root/current" ]]; then
    echo 'Current must be a release symlink' >&2
    exit 1
fi
if [[ -n "$old_release" ]]; then
    [[ "$old_release" == "$site_root/releases/"* ]] || { echo 'Current release is outside releases directory' >&2; exit 1; }
    # Existing browser tabs can finish loading their immutable snapshot and assets.
    cp -an "$old_release/data/." "$release_dir/data/"
    cp -an "$old_release/assets/." "$release_dir/assets/"
    ln -sfn "$old_release" "$site_root/.previous-next"
    mv -Tf "$site_root/.previous-next" "$site_root/previous"
fi
ln -sfn "$release_dir" "$site_root/.current-next"
mv -Tf "$site_root/.current-next" "$site_root/current"
printf 'Released %s\n' "$release_id"

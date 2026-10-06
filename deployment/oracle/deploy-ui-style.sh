#!/bin/sh
set -eu
umask 077

compose_dir=/opt/process-guide/app/deployment/oracle
runtime_dir=/opt/process-guide/runtime
container=process-guide-oracle-app-1
release_image=process-guide:oracle-design-20261006
rollback_image=process-guide:oracle-ui-before-design-20261006
public_origin=https://process-guide.140-238-175-209.sslip.io

compose_app() {
  override=$1
  docker compose --project-directory "$compose_dir" \
    -f "$compose_dir/docker-compose.yml" \
    -f "$compose_dir/micro.override.yml" \
    -f "$compose_dir/report-fonts.override.yml" \
    -f "$compose_dir/cueveris-ui.override.yml" \
    -f "$override" \
    up --detach --wait --wait-timeout 120 --no-deps app
}

restore_previous() {
  test -f "$compose_dir/ui-style.rollback.override.yml"
  restored_tmp=$(mktemp "$compose_dir/ui-style.override.XXXXXX")
  cp "$compose_dir/ui-style.rollback.override.yml" "$restored_tmp"
  mv "$restored_tmp" "$compose_dir/ui-style.override.yml"
  compose_app "$compose_dir/ui-style.override.yml"
}

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run this script with sudo on the existing Oracle server.' >&2
  exit 1
fi

action=${1:-}
if [ "$action" = rollback ]; then
  restore_previous
  echo 'Previous application image restored; persistent volumes retained.'
  exit 0
fi
if [ "$action" != build ] && [ "$action" != deploy ]; then
  echo 'Usage: deploy-ui-style.sh build|deploy ARCHIVE SHA256 [EXPECTED_ACTIVE_IMAGE_ID]; or deploy-ui-style.sh rollback' >&2
  exit 2
fi
archive=${2:?Provide the release archive}
expected_sha=${3:?Provide the expected archive SHA256}
expected_active_image_id=${4:-sha256:9d7a907975af43b7d12a28a67989e66fe95cf0567a8e6bd2e56ee0a288673554}
case "$expected_active_image_id" in
  sha256:*) expected_image_digest=${expected_active_image_id#sha256:} ;;
  *) echo 'Invalid expected active image ID; use sha256 followed by 64 lowercase hexadecimal digits.' >&2; exit 2 ;;
esac
case "$expected_image_digest" in *[!0-9a-f]*|'') echo 'Invalid expected active image ID.' >&2; exit 2 ;; esac
test "${#expected_image_digest}" -eq 64
case "$expected_sha" in *[!0-9a-f]*|'') echo 'Invalid SHA256.' >&2; exit 2 ;; esac
test "${#expected_sha}" -eq 64
test -f "$archive"
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum --check --status

context="$runtime_dir/design-20261006-$expected_sha"
mkdir -p "$context"
# The local preparer archives only the explicit build inputs, with safe names.
if tar -tzf "$archive" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
  echo 'Unsafe archive path.' >&2
  exit 1
fi
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$context"
(cd "$context" && sha256sum --check --status SHA256SUMS)
docker image inspect process-guide:oracle-cueveris-20261006 >/dev/null
existing_sha=$(docker image inspect "$release_image" --format '{{index .Config.Labels "org.cueveris.payload-sha256"}}' 2>/dev/null || true)
if [ "$existing_sha" != "$expected_sha" ]; then
  # Containerd may forget an untagged image even while its container is running.
  active_before_build=$(docker inspect "$container" --format '{{.Image}}')
  release_before_build=$(docker image inspect "$release_image" --format '{{.Id}}' 2>/dev/null || true)
  if [ "$active_before_build" = "$release_before_build" ]; then
    preserved_image="process-guide:oracle-design-preserved-${active_before_build#sha256:}"
    docker tag "$active_before_build" "$preserved_image"
  fi
  docker build --label "org.cueveris.payload-sha256=$expected_sha" --tag "$release_image" "$context"
fi
if [ "$action" = build ]; then
  echo "Verified release image ready: $release_image"
  exit 0
fi

new_image_id=$(docker image inspect "$release_image" --format '{{.Id}}')
active_image_id=$(docker inspect "$container" --format '{{.Image}}')
if [ "$active_image_id" != "$expected_active_image_id" ] && [ "$active_image_id" != "$new_image_id" ]; then
  echo 'Production changed concurrently. The active app is neither the explicitly expected image nor this release; activation stopped before changing the app, rollback tag or overrides.' >&2
  exit 1
fi
if [ "$active_image_id" != "$new_image_id" ]; then
  # Preserve the exact currently running image before recreating this one service.
  if docker image inspect "$active_image_id" >/dev/null 2>&1; then
    docker tag "$active_image_id" "$rollback_image"
  else
    active_payload=$(docker inspect "$container" --format '{{index .Config.Labels "org.cueveris.payload-sha256"}}' 2>/dev/null || true)
    rollback_payload=$(docker image inspect "$rollback_image" --format '{{index .Config.Labels "org.cueveris.payload-sha256"}}' 2>/dev/null || true)
    case "$active_payload" in *[!0-9a-f]*|'') active_payload= ;; esac
    if [ "${#active_payload}" -ne 64 ] || [ "$active_payload" != "$rollback_payload" ]; then
      echo 'Active image metadata is unavailable and the rollback image does not match its recorded payload. Restore a checksum-verified image from the original release context before activation.' >&2
      exit 1
    fi
    echo 'Using the recovered rollback image with the same verified release payload.'
  fi
  rollback_tmp=$(mktemp "$compose_dir/ui-style.rollback.override.XXXXXX")
  printf 'services:\n  app:\n    image: %s\n' "$rollback_image" > "$rollback_tmp"
  mv "$rollback_tmp" "$compose_dir/ui-style.rollback.override.yml"
fi
style_tmp=$(mktemp "$compose_dir/ui-style.override.XXXXXX")
cp "$context/ui-style.override.yml" "$style_tmp"
mv "$style_tmp" "$compose_dir/ui-style.override.yml"

activation_attempted=1
restore_on_error() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ] && [ "$activation_attempted" -eq 1 ] && [ -f "$compose_dir/ui-style.rollback.override.yml" ]; then
    echo 'Release verification failed. Restoring the previous app image.' >&2
    restore_previous || true
  fi
  exit "$result"
}
trap restore_on_error EXIT
trap 'exit 130' HUP INT TERM
compose_app "$compose_dir/ui-style.override.yml"
docker exec --interactive "$container" sha256sum --check --status < "$context/app-SHA256SUMS"
docker exec "$container" node --input-type=module -e '
  import assert from "node:assert/strict";
  import fs from "node:fs";
  const health = await (await fetch("http://127.0.0.1:8101/api/health")).json();
  assert.equal(health.ok, true); assert.equal(health.mock, false); assert.equal(health.providers.openai, true);
  const servers = fs.readdirSync("/proc").filter(id => /^\d+$/.test(id)).filter(id => {
    try {
      const command = fs.readFileSync(`/proc/${id}/cmdline`, "utf8").split("\0");
      return /(?:^|\/)node$/.test(command[0] || "") && command.includes("dist/server.js");
    } catch { return false; }
  });
  assert.equal(servers.length, 1);
  assert.equal(/^Uid:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${servers[0]}/status`, "utf8"))?.[1], "1000");
'
curl --fail --silent --show-error --max-time 20 "$public_origin/api/health" >/dev/null
for video in cueveris-manufacturing-demo.mp4 cueveris-leica-workflow-demo.mp4; do
  range_status=$(curl --silent --show-error --max-time 20 --range 0-0 -o /dev/null -w '%{http_code}' "$public_origin/media/$video")
  test "$range_status" = 206
done
for asset in favicon.svg media/cueveris-manufacturing-demo.jpg media/cueveris-manufacturing-demo.json media/cueveris-manufacturing-demo.txt media/cueveris-leica-workflow-demo.jpg media/cueveris-leica-workflow-demo.json media/cueveris-leica-workflow-demo.txt media/cueveris-leica-workflow-demo.vtt media/leica-m10-guidance.txt media/cueveris-report-preview.html media/process-guide-real-scenarios/index.html INTER-LICENSE.txt; do
  curl --fail --silent --show-error --max-time 20 "$public_origin/$asset" >/dev/null
done
activation_attempted=0
echo "Release healthy: $release_image; runtime UID 1000; HTTPS, byte ranges and all payload hashes verified."
echo 'Persistent application and Caddy volumes retained.'

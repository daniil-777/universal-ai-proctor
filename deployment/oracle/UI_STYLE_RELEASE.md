# Cueveris report and editor release — 6 October 2026

This release updates the existing Oracle application. It does not change the
private environment, provider settings, ingress, account volume or Caddy volumes.
The layer extends the existing `process-guide:oracle-cueveris-20261006` image,
with its Linux dependencies, report-font patch and verified media library.

The patch contains the rebuilt frontend index and hashed assets, the four
manufacturing demo assets, the six Leica walkthrough and guidance assets,
the matching Cueveris favicon, the public Inter license, the updated real-scenario
library index, a labeled synthetic report preview, and the rebuilt backend `app.js`, `domain/review.js`,
`media/analysisPdf.js`, `media/analysisReport.js`, `media/reportOverview.js`
and `llm/questionContract.js`. The review module adds an optional finite video
duration to review snapshots. The report renderers retain snapshot-local evidence
references, source/instruction scope and a grouped criterion review queue. The
question contract
supports guide-based questions without claiming that unseen video has been
verified. The frontend includes adjustable video view, guidance panel and text
sizes, plus matching report links, scope, queue and duration-aware timeline.
Leica's original film remains in its official YouTube player.
Existing media and older hashed assets remain available. `Dockerfile.ui-style`
retains the base entrypoint and health check. The entrypoint starts the Node
server as UID 1000; static/compiled files remain root-owned and readable.

## Prepare after checks and the final source commit

Run from the canonical repository with the verified frontend and backend builds:

```sh
node scripts/prepare-oracle-ui-release.mjs
```

The script creates a fresh temporary directory, an explicit build context and
`cueveris-ui-release.tar.gz`. It prints the archive path and its SHA256. The
context includes a source-revision receipt, per-file hashes and application-path
hashes. It never copies `.env`, dependencies, accounts, uploads or the repository
itself. Generate the final archive after committing so the receipt identifies
the released source. Its `source_dirty` field must be `false` for that final
archive.

The existing host is `ubuntu@140.238.175.209`. Use the owner's existing SSH key
outside the repository. Set `release_archive`, `release_sha256` and `ssh_key`
to the preparer's output and the existing key path. Shell variables contain
paths and an artifact checksum, not provider credentials.

```sh
scp -i "$ssh_key" "$release_archive" \
  ubuntu@140.238.175.209:/tmp/cueveris-ui-release.tar.gz
scp -i "$ssh_key" deployment/oracle/deploy-ui-style.sh \
  ubuntu@140.238.175.209:/tmp/deploy-cueveris-ui-style.sh
ssh -i "$ssh_key" ubuntu@140.238.175.209 \
  "sudo sh /tmp/deploy-cueveris-ui-style.sh build /tmp/cueveris-ui-release.tar.gz '$release_sha256'"
```

`build` verifies the archive and every input, then creates
`process-guide:oracle-design-20261006`. It does not replace the running app.
Repeating it with the same verified archive reuses that image. The payload stays
under `/opt/process-guide/runtime/design-20261006-SHA256` for review and reuse.
Before replacing a release tag that still names the running image, the script
also preserves it under a unique `oracle-design-preserved-IMAGE_DIGEST` tag.
This keeps its image metadata available in Docker's containerd image store.

## Activate and verify

Once release checks pass, activate that same archive:

```sh
ssh -i "$ssh_key" ubuntu@140.238.175.209 \
  "sudo sh /tmp/deploy-cueveris-ui-style.sh deploy /tmp/cueveris-ui-release.tar.gz '$release_sha256'"
```

The optional fourth argument is the explicitly expected active image ID, in
`sha256:` plus 64 lowercase hexadecimal digits format. It defaults to the frozen
original Cueveris image. For a follow-up design release, read the current app's
immutable image ID immediately before deployment and pass it explicitly:

```sh
expected_active_image_id=$(ssh -i "$ssh_key" ubuntu@140.238.175.209 \
  'sudo docker inspect process-guide-oracle-app-1 --format "{{.Image}}"')
ssh -i "$ssh_key" ubuntu@140.238.175.209 \
  "sudo sh /tmp/deploy-cueveris-ui-style.sh deploy /tmp/cueveris-ui-release.tar.gz '$release_sha256' '$expected_active_image_id'"
```

Activation requires that exact expected image or the already-built new image.
A different active image stops activation before changing the running app,
rollback tag or deployment overrides, preserving concurrent production work.

If an earlier overwritten tag has already lost its image metadata, rebuild the
original checksum-verified release context under the rollback image tag. The
script accepts that existing rollback image only when its nonempty
`org.cueveris.payload-sha256` label exactly matches the running container's
recorded payload. Verify its application hashes against the original receipt
and running app before using this recovery. Do not commit a running container:
that would capture its private runtime configuration.

The script saves the exact running image under
`process-guide:oracle-ui-before-design-20261006`, writes an image-only rollback
override, then recreates only `app`. It preserves all volume mounts and leaves
Caddy running. Compose retains the current micro-instance memory limits and
waits for the inherited `/api/health` readiness check. A short app interruption
ends process-local live sessions; saved accounts and reports remain on the same
volume.

The exact service update is:

```sh
sudo docker compose --project-directory /opt/process-guide/app/deployment/oracle \
  -f /opt/process-guide/app/deployment/oracle/docker-compose.yml \
  -f /opt/process-guide/app/deployment/oracle/micro.override.yml \
  -f /opt/process-guide/app/deployment/oracle/report-fonts.override.yml \
  -f /opt/process-guide/app/deployment/oracle/cueveris-ui.override.yml \
  -f /opt/process-guide/app/deployment/oracle/ui-style.override.yml \
  up --detach --wait --wait-timeout 120 --no-deps app
```

After startup, the script verifies every application payload hash, real-provider
health, runtime UID 1000, public HTTPS health, the demo's HTTP 206 byte range, and
the poster/credits/metadata/license URLs. A failed activation or verification
automatically restores the saved image using the same persistent volumes.
Public desktop, phone, tablet, dark appearance and report/account browser checks
remain part of the final release verification.

## Roll back

```sh
ssh -i "$ssh_key" ubuntu@140.238.175.209 \
  'sudo sh /tmp/deploy-cueveris-ui-style.sh rollback'
```

Rollback atomically changes the active image-only override to the saved image,
then recreates only `app` and waits for health. It leaves the previous/new images
and payload available for review. Never use `down --volumes` or volume pruning
as part of this release.

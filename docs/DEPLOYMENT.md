# Full-feature container deployment

Deploy the repository as one Node.js 24 server behind HTTPS, with a private persistent disk mounted at `/data`. The server serves the built React app and API from the same origin. This retains video uploads, camera guidance, document-driven workflows, model selection, voice, reports, incident clips, downloads, accounts and bundled examples. Live analysis sessions remain process-local; saved account results survive restarts on the retained disk. The simulator stays a development placeholder.

The repository root is `guidance-app`: `Dockerfile`, `render.yaml`, `fly.toml`, `backend`, `frontend` and `scripts` are siblings. Build from this directory. See [ONLINE_DEPLOYMENT.md](ONLINE_DEPLOYMENT.md) for the account/session, ingress and backup requirements already implemented in the app.

## What the image contains

The multi-stage Docker build installs locked Linux dependencies, FFmpeg, ffprobe, DejaVu fonts, a process supervisor and the compiled backend/frontend. Build-only `FFMPEG_BIN=/usr/bin/ffmpeg` directs the installed `ffmpeg-static` package to the existing Debian binary, so its installer skips a duplicate binary download. Report font sources are copied by the existing backend build script. Media is downloaded from `deployment/media-manifest.json` with `node scripts/download-assets.mjs` before building; the downloader verifies immutable release hashes and retains the exact original paths. Failure to fetch or verify a required asset must fail the build. No runtime media fetch is needed.

The build context excludes `.env` files, local dependency backups, SQLite files, uploads and local video bytes. Provider keys belong only in the host's private runtime settings. They must never be supplied as Docker build arguments or `VITE_*` frontend variables. The runtime image copies only compiled code, dependencies and application assets. It starts in `/app/backend`, preserving the existing relative library and frontend paths.

The entrypoint initializes ownership of the disk's account/upload directories, then runs Node and its children as the `node` user. Its brief initialization needs root on a newly root-owned volume. Hosts enforcing an entirely non-root container should pre-create `/data/accounts` and `/data/uploads` for UID/GID 1000 and start with that user. Production startup requires `ACCOUNT_PUBLIC_ORIGIN` to be configured.

## Oracle Always Free

[Oracle deployment instructions](ORACLE_FREE_DEPLOYMENT.md) provide a Docker Compose configuration with Caddy HTTPS and a private persistent application volume. This preserves the existing single-server architecture on an eligible ARM VM. Free server capacity depends on the account's home region; idle instances can be reclaimed. AI usage still incurs provider charges. The configuration does not create a cloud account or activate resources.

## Render configuration and cost

Use a Docker web service in Frankfurt, one `1c-2g` instance and a 5 GB persistent disk at `/data`. The checked-in Blueprint deliberately disables automatic deployment; selecting or syncing it can still create paid resources. The owner should review the final service and disk charge in Render before activation. [Render Blueprint reference](https://render.com/docs/blueprint-spec)

Official pricing checked on 2026-10-05 lists the 1 CPU / 2 GB instance at **$25/month**, plus **$0.25/GB/month** for disk storage: **$26.25/month** for this template before provider usage, bandwidth/build overages, workspace charges or taxes. The cheaper 512 MB tier is $7/month and replaces the old Starter label, but the app's measured report/password workloads can exceed that memory. The template uses the 2 GB tier for those full features. Prices should be reconfirmed on the activation screen. [Render pricing](https://render.com/pricing)

Persistent disks require paid services. They cannot be used during builds, attach to one instance, and cause a short interruption on redeploy. Five GB provides room for a small pilot's account database and disposable video copies; monitor usage and enlarge it before running out of space. A maximum-size upload is 512 MB, so several simultaneous videos can use much of this capacity. Disk size cannot be reduced later. [Render disk requirements](https://render.com/docs/disks)

Configure the service from this repository's `render.yaml`, or enter its values manually:

| Setting | Value |
| --- | --- |
| Runtime / context / Dockerfile | Docker / `.` / `./Dockerfile` |
| Internal host / port | `0.0.0.0` / `8101` |
| Health check | `/api/health` |
| Account directory | `DATA_DIR=/data/accounts` |
| Video working directory | `UPLOAD_ROOT=/data/uploads` |
| Cookie policy | `ACCOUNT_COOKIE_SECURE=true` |
| Public origin | Exact assigned HTTPS URL, e.g. `https://your-service.onrender.com`, without path or trailing slash |
| Real providers | `MOCK=0`; configure `OPENAI_API_KEY` privately |

Add optional `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` or `HF_API_KEY` privately to enable those providers. A local model requires its own reachable inference server. AI speech needs the OpenAI key; browser speech remains available as a fallback. Camera and microphone permissions need the external HTTPS site. After adding a custom domain, update `ACCOUNT_PUBLIC_ORIGIN` to the origin actually used for account operations.

## Fly.io alternative

`fly.toml` is a single-server alternative with HTTPS routing, a 2 GB shared-CPU Machine and a 5 GB volume. Set its unique `app` name and matching `ACCOUNT_PUBLIC_ORIGIN` before deployment. Keep **one Machine**, because the SQLite database and active guidance sessions are not distributed. Fly volumes are local to their Machine/region, not shared or automatically replicated. [Fly configuration](https://docs.fly.io/reference/configuration), [Fly volumes](https://docs.fly.io/volumes/overview/)

After the owner has selected the account and reviewed its current paid rates, authenticate with `fly auth login`, create the app without deploying, and use Fly's remote builder if Docker is not installed locally. These commands create paid resources when deployment/volume creation is performed:

```sh
fly launch --no-deploy --config fly.toml
fly secrets import --stage < /path/to/private/provider-secrets.env
fly deploy --remote-only --ha=false --config fly.toml
fly scale count 1
```

The private provider file uses `NAME=value` lines such as `OPENAI_API_KEY=...`; keep it outside the repository. Importing through standard input keeps secret values out of command arguments and shell history. Do not enable automatic extra Machines or horizontal replicas. The checked-in configuration does not store secrets or create infrastructure by itself. Review Machine, volume, snapshot and egress pricing for the chosen region. [Fly pricing](https://fly.io/docs/about/pricing/)

## Local container verification

Native x86 and ARM Linux container checks passed for commit `e3b7236`: real FFmpeg decoding, all six examples, mocked guidance/Q&A, uploads, report exports, saved accounts after restart and the private Caddy HTTPS proxy. The x86 source run passed 324 backend and 152 frontend tests. [x86 verification](deployment-verification-e3b7236.json), [ARM verification](oracle-arm-verification.json). These runs use no provider keys or paid AI calls; public cloud deployment and real-provider checks remain separate.

Docker must be installed and running to execute this check. Run from the repository root after the released media manifest and downloader are present:

```sh
docker build --pull -t process-guide:release .
docker volume create process-guide-data
docker run --rm --name process-guide --publish 8101:8101 \
  --mount source=process-guide-data,target=/data \
  --env ACCOUNT_PUBLIC_ORIGIN=http://localhost:8101 \
  --env ACCOUNT_COOKIE_SECURE=false \
  --env-file /path/to/private/runtime.env \
  process-guide:release
```

The HTTP origin and insecure cookie setting in this command are only for this local test. Keep `ACCOUNT_COOKIE_SECURE=true` and use the exact HTTPS origin online. Keep the runtime env file outside the repository; it contains the desired provider keys and `MOCK=0`. Request `/api/health`, then open `http://localhost:8101`. The health endpoint reports availability, not a successful paid model inference.

Verify the released deployment through its HTTPS URL: load all six sample videos and guidance documents; check playback/seeking and byte-range responses; upload a video and TXT; exercise video-only and camera guidance; ask questions and play voice; produce the final PDF/HTML/ZIP report and incident clips; register/sign in/save an activity, restart the same single service, and confirm the activity persists. Confirm account cookies are Secure/HttpOnly/SameSite and assets remain available after restart. Verify the process inside the container runs as UID 1000. Use a private SQLite-consistent backup/restore drill before relying on stored results.

## Netlify

Netlify can host the built frontend, but its request-driven functions are not a direct replacement for this app's persistent Node process, SQLite disk, FFmpeg work and large video uploads. Current synchronous functions have a 60-second execution ceiling and 6 MB buffered request/response limit; binary encoding reduces usable upload size further. Background functions have a 15-minute ceiling and a much smaller payload limit. These conflict with the current long-running guidance and up-to-512-MB upload design. [Netlify function limits](https://docs.netlify.com/build/functions/configuration/)

Keeping a Netlify frontend would still require the full backend elsewhere plus a carefully configured same-origin proxy. The supplied single-server container serves the existing UI/API together and preserves the current cookie and streaming behavior with fewer deployment changes.

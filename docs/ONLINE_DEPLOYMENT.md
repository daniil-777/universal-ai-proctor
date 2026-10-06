# Online deployment

The [public full app](https://guide.demtsev.com/) is active on an Oracle Always Free VM with HTTPS and persistent storage. It works independently of the owner's computer. The branded entry redirects to `https://process-guide.140-238-175-209.sslip.io`, where the frontend and backend share one origin. Accounts belong to that server; local accounts are separate. The [GitHub Pages interface](https://daniil-777.github.io/universal-ai-proctor/) remains a preview with a link to the full app. See [Oracle deployment](ORACLE_FREE_DEPLOYMENT.md) for the activated configuration and checks, and [production deployment](DEPLOYMENT.md) for alternatives.

## Supported deployment shape

Use one long-running Node.js 24 instance with a private persistent disk, an HTTPS endpoint and the frontend/API served from the same origin. A VM or a managed Node service with a durable volume fits this design. The server serves `frontend/dist` alongside its API. The account store uses Node's built-in SQLite; no external database service is required for this single-instance deployment. [Node SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

The live guidance/session cache is process-local and expires after one hour of inactivity. Account users, authentication sessions, rate-limit state and saved training results live in SQLite and survive restarts when the disk is retained. An account snapshot does not restore the original video or a running camera session.

Reserve memory headroom for report/native buffers, media decoding and concurrent password hashing, then measure capacity on the actual host. The report scheduler admits one active worker plus two waiting snapshots with a 30-second deadline; its 384 MB V8 heap limit is not a cap on total process RSS. The extreme local stress sample reached 653.14 MB across the process/worker. Up to two scrypt derivations can also execute concurrently, each requiring approximately 128 MB of working memory. These limits control concurrency rather than establish a cloud instance size or throughput guarantee.

This release does not provide distributed live sessions or synchronized multi-instance account storage. Do not deploy it to an ephemeral serverless filesystem, run multiple independent replicas against separate SQLite files, or place a WAL database on a shared network filesystem. SQLite's WAL design requires the participants to share local-host memory and filesystem semantics. [SQLite WAL documentation](https://sqlite.org/wal.html)

## Build and start

Set the deployment project directory to `guidance-app`. Install Node.js 24 and make `ffmpeg` and `ffprobe` available on PATH. Native dependencies such as Sharp must be installed on the deployment platform rather than copied from this Mac. Preserve the guidance library, evaluation assets used by the application, both package lockfiles, backend report-font sources and scripts along with the application code.

Run these commands from `guidance-app`:

```sh
node --version
npm ci --include=dev --prefix backend
npm ci --include=dev --prefix frontend
npm run check
npm test
npm run build
```

Development dependencies are explicitly included for TypeScript/Vite even if the build environment sets `NODE_ENV=production`. Browser end-to-end checks additionally require the configured Chrome/WebKit installations; run those in the release test environment using `npm run test:e2e`.

Configure the runtime environment below, then use this start command from the same project directory:

```sh
npm start
```

The root start script launches Node with `guidance-app/backend` as its working directory. It expects both dependency directories and the built frontend/backend to be present. The alternative start command is `npm start` with the deployment working directory set explicitly to `guidance-app/backend`, after the root build has completed. Do not launch `backend/dist/server.js` from an arbitrary directory: relative `.env`, account and upload paths depend on the backend working directory.

Build each release explicitly before restarting. The start script only builds when output files are missing; existing output is not automatically refreshed because source files changed.

## Runtime environment

Configure environment variables through the host's private runtime settings. The following is an example; replace the origin and disk paths with the values of the selected deployment:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=8101
MOCK=0
ACCOUNT_PUBLIC_ORIGIN=https://guide.example.com
ACCOUNT_COOKIE_SECURE=true
DATA_DIR=/data/process-guide/accounts
UPLOAD_ROOT=/data/process-guide/uploads
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
HF_API_KEY=
TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=nova
```

| Setting | Requirement |
| --- | --- |
| `HOST` | `0.0.0.0` for a managed service receiving routed traffic; loopback is the local default. On a VM, loopback can be retained when a local reverse proxy is the only ingress. |
| `PORT` | Use the host's assigned internal port or `8101`; the HTTPS proxy routes public traffic to that port. |
| `ACCOUNT_PUBLIC_ORIGIN` | Exact external HTTPS origin, such as `https://guide.example.com`, without a path or trailing slash. A nonstandard port must be included. Account mutations check this origin. |
| `ACCOUNT_COOKIE_SECURE` | Keep `true` online. Cookies are HttpOnly and SameSite=Strict. `false` is solely for deliberate local HTTP development; it is not an HTTPS deployment workaround. |
| `TRUST_PROXY_CIDRS` | Optional exact IPv4 `/32` or IPv6 `/128` addresses of the immediate private reverse proxy, comma separated. Unset ignores forwarding headers. The Oracle setup pins Caddy to `172.30.250.3/32`; keep the backend port private and have the proxy replace client-supplied forwarding headers. Broad subnet trust and extra forwarded hops are rejected. |
| `DATA_DIR` | Writable private persistent directory. Default `.data/accounts` resolves to `guidance-app/backend/.data/accounts`; the file is `accounts.sqlite`. Use an absolute mount path online. |
| `UPLOAD_ROOT` | Private working storage for server video copies. Default `.data/uploads` resolves from the backend directory. Copies are removed on guidance-session eviction and normal shutdown; saved account results are separate. |
| Provider key | Configure at least one supported visual provider. AI speech needs an OpenAI key; browser speech remains a fallback. Keep every key server-side and out of frontend build variables. |
| `MOCK` | `0` for real providers. `1` supplies demo behavior and must not be described as real inspection. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Optional explicit binary paths when the host does not expose them on PATH. |

Keep accounts, uploads and backups outside publicly served asset folders and outside source-control/deployment artifacts. The application creates its account directory with restricted permissions, but the host must provide a writable persistent mount owned by the runtime user.

## Ingress and access

Serve the whole app at the origin root and use HTTPS. Frontend and backend share that origin; no separate cross-origin frontend is configured here. Preserve normal Origin/Cookie headers and support streaming replies and video byte-range requests. Set ingress upload limits deliberately: the application accepts videos up to 512 MB and guidance documents up to 2 MB. Model operations have bounded application timeouts; the proxy should allow the corresponding request to finish rather than cutting streaming responses early.

For a protected pilot, put an access gateway in front of the entire application and its API. Account sign-in protects account-owned training history, reports and deletion. It does not require sign-in for anonymous video/camera analysis, upload or speech synthesis. Publicly exposing those routes also exposes provider usage; gateway access and request limits should apply to them.

Authentication includes SQLite-backed login/registration limits and bounded expensive password work. `TRUST_PROXY_CIDRS` enables only explicitly configured immediate proxy addresses; Oracle pins this to Caddy's private `/32`. Without it, forwarded IP headers are ignored. Keep the backend port private and have the proxy replace client-supplied forwarding headers.

Email is the account identifier. This release has no email-verification/delivery service, self-service password reset, enterprise SSO, invitation-only registration or administrator role management. Select the pilot's access policy accordingly. Passwords are stored as salted scrypt hashes; the implementation uses the asynchronous Node API. [Node scrypt documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)

## Persistent data and backups

Saved activities are private to their account. Resaving the same source/reference updates that activity. The limits are 500 activities per account and 2 MB per snapshot. Photographic evidence is excluded unless the operator opts in; original video/audio bytes and the original guidance document are not copied into the account. Workflow descriptions, names, operator wishes and decisions are retained.

Back up the database privately and retain the disk between releases. The simplest consistent maintenance backup is to stop the app gracefully, copy the account directory, then restart against the same directory. For live backups, use SQLite's supported backup mechanism rather than copying only `accounts.sqlite` while writes are active: WAL state can be part of the committed database state. A copied database/WAL mismatch can lose or corrupt records. [SQLite backup/copy cautions](https://sqlite.org/howtocorrupt.html)

Verify restoration on a separate private instance before relying on a backup. Account deletion removes owned records and authentication sessions from the active database; downloaded files and externally retained backups have their own retention lifecycle.

## Deployment verification

After an actual host is selected and deployed:

1. Open the HTTPS URL and check `/api/health`; confirm the frontend and API are served together and the intended provider is configured.
2. Create two test accounts. Verify one cannot read, download or delete the other's saved result. Confirm Secure/HttpOnly/SameSite cookies, sign-out and rejected mismatched-Origin mutations.
3. Run a prepared non-sensitive video/TXT example, record readiness and an exception, and save without photographic evidence. Confirm separate AI/manual metrics and a valid downloadable PDF/HTML. Include unsupported PDF-font characters such as Chinese/Arabic text; verify the explicit 422 response and preservation in the Offline HTML download, including saved-account reports.
4. Explicitly opt in to images for a second result and confirm the storage choice in the saved report.
5. Restart the service without replacing its disk. Sign in and verify retained results; confirm the expired/restarted live session is distinct from saved history.
6. Check camera/microphone permission behavior, response streaming, actual video seeking and the supported mobile share/download path over HTTPS. Physical device checks remain separate from viewport emulation.

No hosted runtime, container build or cloud capacity test is claimed by this document. The running local application is verified separately in [VALIDATION.md](VALIDATION.md); the root release checks supply final test counts.

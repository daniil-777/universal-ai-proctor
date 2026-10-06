# Oracle Always Free deployment

The [public full app](https://guide.demtsev.com/) was activated on **2026-10-06** in Oracle's Zurich home region. Its branded entry redirects the browser to `https://process-guide.140-238-175-209.sslip.io`; all subsequent uploads, streams and account requests use that full HTTPS origin directly. The redirect does not proxy uploads through Cloudflare. The app runs independently of the owner's computer.

The live server uses **one Always Free `VM.Standard.E2.1.Micro`**, Ubuntu 24.04 AMD64, 1 GB RAM, a 50 GB boot disk and 2 GB host swap. A1 launch and the capacity query both found no available ARM hosts, so the verified AMD image was used without upgrading the account or activating a paid host. This small server is suited to light pilot traffic; CPU-bound extraction and concurrent report/password work can be slower than on the recommended A1 shape. The checked-in [micro override](../deployment/oracle/micro.override.yml) limits app memory to 640 MB, Node heap to 384 MB, Caddy to 128 MB and FFmpeg concurrency to one.

Node 24 / FFmpeg runs as UID 1000 behind Caddy with publicly trusted TLS. Only 80/443 are public; SSH is restricted to the owner's address and 8101 stays private. One persistent app volume retains SQLite accounts, saved reports and temporary uploads; separate Caddy volumes retain certificates. Live guidance sessions remain in memory and end on restart. Provider keys are private runtime settings and are absent from Git and the image. AI calls still incur provider charges.

## Public verification on 2026-10-06

- All six video/guide pairs loaded, including the unchanged original surgical instructions; all video byte ranges returned 206.
- Trusted HTTPS browser checks passed on desktop Chrome, phone-sized Chrome and tablet-sized WebKit: original video playback and seek, six extracted surgical steps, no horizontal overflow or console errors. These checks do not prove physical camera/microphone permission behavior on every device.
- Real OpenAI analysis used three frames (7.1 s); question streaming delivered its first token in 2.36 s; real speech synthesis returned valid MP3 in 2.45 s. These are single smoke timings, not latency guarantees or recognition accuracy metrics.
- Uploads, bookmark evidence, PDF, offline HTML, ZIP and account lifecycle passed. A default surgical PDF initially failed on arrows/checkmarks; locally embedded symbol fonts now preserve those characters, and the live 11-page export passed text and visual checks.
- A saved surgical report and sign-in survived an actual app restart; secure/HttpOnly/Strict cookies and rejection of wrong-origin account mutations passed. Temporary QA accounts were removed.
- One initial server-decoded analysis connection reset during parallel checks. A retry using the normal browser-frame path passed, and subsequent server-side surgical decoding passed in 871 ms. No out-of-memory event or unexpected container restart was observed. Load limits should still be measured before wider use.

The public receipt is [oracle-public-verification.json](oracle-public-verification.json). The deployed base is the SHA256-verified [runtime-d943726 snapshot](https://github.com/daniil-777/universal-ai-proctor/releases/tag/runtime-d943726), plus the tested report-font patch. Future normal builds include the patch directly from source.

## Free resources to select

Oracle's official documentation checked on **2026-10-06** includes two Always Free AMD micro instances, **2 OCPU / 12 GB RAM** across Ampere A1 instances and **200 GB total boot/block storage** in the home region. The older 4 OCPU / 24 GB allowance must not be assumed. If ARM capacity becomes available, one eligible Ubuntu A1 instance with 2 OCPU, 12 GB RAM and a 50 GB boot disk provides substantially more headroom. Confirm the console labels and quotas before creating resources. [Oracle resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Free shapes can be unavailable in the chosen home region. Idle VMs may be reclaimed under Oracle's seven-day utilization policy. Do not rely on this free tier for guaranteed uptime. [Capacity and idle-instance rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Signup normally requires a mobile number and payment card. Oracle may place temporary card authorization holds; its documentation says there are no actual charges unless the account is upgraded. **Do not upgrade to Pay As You Go automatically**, choose trial-only resources, or enable extra CPUs/disks beyond the Always Free allowance. The 30-day trial credit is separate from Always Free resources. [Signup and trial rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm), [card verification](https://www.oracle.com/cloud/free/faq/)

Hosting can be free; model API usage is billed by its provider. A domain registration can also cost money: use a hostname already controlled by the owner or a suitable free DNS subdomain. These checked-in templates do not create accounts or provision resources automatically.

## Verify ARM before creating the VM

**Verified on 2026-10-05:** the [native ARM run 37313028738](https://github.com/daniil-777/universal-ai-proctor/actions/runs/37313028738) and [x86/source run 37313024004](https://github.com/daniil-777/universal-ai-proctor/actions/runs/37313024004) both passed for commit `e3b7236cc925d5f0e373014603369ac714caa244`. The ARM run built and tested the app on `ubuntu-24.04-arm`, including Node 24, FFmpeg, all six examples, uploads, reports, retained account activity after restart, and private Caddy HTTPS/SSE/range/cookie checks. See the [ARM receipt](oracle-arm-verification.json) and [current x86/source receipt](deployment-verification-e3b7236.json) for actual run facts and log hashes. The first ARM attempt stopped before app build because an unpublished Caddy image tag was selected; the passing run uses the registry-verified multiarch image digest. No Oracle VM was deployed, and public TLS, real-device camera/microphone access and live AI accuracy remain separate deployment checks.

Run the repository's **Verify Oracle ARM container** workflow manually. It calls the same container smoke workflow used on x86, using the native `ubuntu-24.04-arm` runner. It checks the host architecture, Docker image architecture, Node `process.arch`, Node 24, FFmpeg/ffprobe, unprivileged runtime, all six videos/guides, real frame decoding, mocked guidance/Q&A/SSE, PDF/HTML/ZIP, uploads and account lifecycle. A container restart must retain saved accounts and PDFs. It also validates the Oracle Compose/Caddy configs and tests the actual app behind Caddy with a local internal TLS CA: spoofed forwarding headers, immediate SSE delivery, video ranges, secure cookies and account Origin protection. All containers, certificates, networks and volumes in this proxy check are isolated and temporary. Provider credentials are absent and paid AI calls are zero. The separate source checks continue on the normal main workflow. [GitHub native ARM runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [workflow reuse](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)

This workflow does not provision Oracle resources or test public TLS. The active deployment's separate public checks are recorded above.

## Configure the selected VM

Install Docker Engine and the Compose plugin using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), which support ARM64. Use `sudo docker` unless the owner deliberately configures Docker group access. Keep Docker enabled at boot.

Point the public hostname's DNS A record to the VM's public IPv4 address. Remove stale AAAA records unless IPv6 is configured correctly. Allow inbound **TCP 80 and 443** in both the Oracle subnet security rules and the VM firewall. Restrict SSH TCP 22 to the owner's trusted address. Do not expose 8101, SQLite or Docker's API. Docker-published ports can bypass ordinary UFW filtering, so enforce the ingress rules at the Oracle network as well. [Docker firewall behavior](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)

Caddy obtains and renews publicly trusted certificates when DNS and ports are reachable, and redirects HTTP to HTTPS. Its certificate volume must survive upgrades. The supplied config keeps API bodies streamed, forwards the browser's Host/Origin, and lets Caddy flush SSE immediately. Frontend assets are compressed independently of API traffic. [Caddy HTTPS requirements](https://caddyserver.com/docs/automatic-https), [streaming proxy behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

Clone the public repository on the VM and prepare the private settings:

```sh
git clone https://github.com/daniil-777/universal-ai-proctor.git
cd universal-ai-proctor/deployment/oracle
umask 077
cp .env.example .env
chmod 600 .env
```

Edit `.env` locally on the VM. Set `APP_DOMAIN` to the plain hostname, for example `guide.your-domain.example`, and `ACME_EMAIL` to the certificate contact. The Compose file derives `ACCOUNT_PUBLIC_ORIGIN=https://APP_DOMAIN` without a path or trailing slash and forces secure account cookies. Add provider keys privately when authorized to enable live AI. Never place credentials in the repository, frontend variables, Docker build arguments, screenshots or command arguments. Avoid printing `docker compose config` after adding real keys; its expanded output contains secrets.

From `deployment/oracle`, validate without printing settings, build the verified media image, and start:

```sh
sudo docker compose config --quiet
sudo docker compose build --pull
sudo docker compose run --interactive=false --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose up --detach --wait --wait-timeout 120
sudo docker compose ps
```

The build context is the repository root (`../..`). It downloads the immutable GitHub Release assets and verifies SHA256 and exact sizes; unavailable or corrupt media fails the build. The backend is private on container port 8101. Only Caddy publishes 80/443. The dedicated Docker bridge is `172.30.250.0/24`, with app `.2` and Caddy `.3`; `TRUST_PROXY_CIDRS=172.30.250.3/32` trusts only the immediate Caddy hop for client-IP limits. Caddy overwrites client-supplied forwarding headers. If this subnet conflicts with an existing host network, change the subnet, both fixed addresses and the exact trust address together before starting. Do not broaden proxy trust or publish the backend port.

The application data lives in `process-guide-oracle-data`, with accounts under `/data/accounts` and uploads under `/data/uploads`. The Caddy data/config volumes retain TLS material. These are local Docker volumes on the VM's boot disk, not new paid Oracle services.

Open `https://APP_DOMAIN` directly on a phone and desktop. Check `/api/health`; provider availability reflects configured keys, not a completed inference. Validate all samples, upload/TXT and video-only guidance, camera/microphone permissions, guardian questions, voice, incident clips and downloaded reports. Register, save an activity, restart `app` and confirm its history/PDF remains available. Check that the account cookie is Secure, HttpOnly and SameSite, and that wrong-origin account mutations fail. Live model testing consumes provider credits, so the mock-only ARM check comes first.

## Updates, retained data and backups

Keep one app replica. Do not use `docker compose down --volumes`, delete the app volume, or prune volumes. Ordinary `up`, `restart` and image rebuilds retain the data volume. Bound Docker logs are configured so they cannot fill the disk indefinitely. Monitor available boot-disk space; each video upload can be up to 512 MiB.

For an update, pull the reviewed source, rebuild, and run `docker compose up --detach --wait`. Retain the previous image/source revision for rollback. Recheck health, examples and saved history. A source rebuild requires outbound access to GitHub Releases, npm and the image registry.

Back up the SQLite database **with its WAL consistently**, not by copying just the main database while the app is running. A straightforward maintenance backup stops the app briefly, archives the entire application volume to a private directory outside the repository, then restarts it. Keep an encrypted copy off the VM and test restoration to a separate volume before relying on it. Caddy's certificate volumes should also be retained or privately backed up. Oracle's optional volume backups share the documented Always Free backup quota; confirm eligibility before selecting them.

Historical x86/source and ARM verification remain in [deployment-verification-e3b7236.json](deployment-verification-e3b7236.json) and [oracle-arm-verification.json](oracle-arm-verification.json). Current public checks are recorded in [oracle-public-verification.json](oracle-public-verification.json).

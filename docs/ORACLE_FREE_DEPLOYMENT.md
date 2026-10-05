# Oracle Always Free deployment

This is a prepared deployment for the existing full app, not an activated Oracle service. It uses the repository's Node 24 / FFmpeg Docker image, a single app instance, the current SQLite account store and one persistent application volume. Caddy serves the UI and API together over HTTPS. Camera, microphone, voice, video/TXT uploads, guardian, reports, incident clips, saved training history and all six examples retain their existing routes and behavior. Live analysis sessions remain in memory and end on a server restart; saved account reports persist.

## Free resources to select

Oracle's official documentation checked on **2026-10-05** specifies **2 OCPU and 12 GB RAM** across Always Free Ampere A1 instances, with **200 GB total boot/block storage** in the home region and 10 TB monthly outbound transfer. The older 4 OCPU / 24 GB allowance must not be assumed. For this app, select one Always Free-eligible `VM.Standard.A1.Flex` Ubuntu ARM instance with 2 OCPU, 12 GB RAM and a 50 GB boot disk. This leaves storage allowance unused and avoids additional services. Confirm the console labels and quotas before creating anything. [Oracle resource limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Free shapes can be unavailable in the chosen home region. Idle VMs may be reclaimed under Oracle's seven-day utilization policy. Do not rely on this free tier for guaranteed uptime. [Capacity and idle-instance rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Signup normally requires a mobile number and payment card. Oracle may place temporary card authorization holds; its documentation says there are no actual charges unless the account is upgraded. **Do not upgrade to Pay As You Go automatically**, choose trial-only resources, or enable extra CPUs/disks beyond the Always Free allowance. The 30-day trial credit is separate from Always Free resources. [Signup and trial rules](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm), [card verification](https://www.oracle.com/cloud/free/faq/)

Hosting can be free; model API usage is billed by its provider. A domain registration can also cost money: use a hostname already controlled by the owner or a suitable free DNS subdomain. No Oracle account creation, VM provisioning, key upload or billable action is performed by these checked-in files.

## Verify ARM before creating the VM

Run the repository's **Verify Oracle ARM container** workflow manually. It calls the same container smoke workflow used on x86, using the native `ubuntu-24.04-arm` runner. It checks the host architecture, Docker image architecture, Node `process.arch`, Node 24, FFmpeg/ffprobe, unprivileged runtime, all six videos/guides, real frame decoding, mocked guidance/Q&A/SSE, PDF/HTML/ZIP, uploads and account lifecycle. A container restart must retain saved accounts and PDFs. It also validates the Oracle Compose/Caddy configs and tests the actual app behind Caddy with a local internal TLS CA: spoofed forwarding headers, immediate SSE delivery, video ranges, secure cookies and account Origin protection. All containers, certificates, networks and volumes in this proxy check are isolated and temporary. Provider credentials are absent and paid AI calls are zero. The separate source checks continue on the normal main workflow. [GitHub native ARM runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [workflow reuse](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)

This workflow does not provision Oracle resources or test public TLS. Complete the HTTPS browser checks below after a deployment is explicitly selected.

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
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
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

The current x86 Linux verification is recorded in [deployment-verification.json](deployment-verification.json). ARM, proxy behavior and the deployed HTTPS browser checks are distinct checks and must be recorded after they actually run.

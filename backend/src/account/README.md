# Persistent training accounts

Requires Node.js 24 or newer. The account store uses Node's built-in SQLite with WAL,
foreign keys, prepared statements and a busy timeout; no external database service
is needed for a single-server deployment.

`DATA_DIR` selects the private persistent storage directory (default
`.data/accounts` relative to the backend working directory). Preserve this disk
when updating/restarting the server. The database contains account password hashes,
hashed expiring session tokens and saved training snapshots. It is never served as
a web asset. The default data folder is gitignored. Keep backups private.

For public deployment use HTTPS, `NODE_ENV=production` and set
`ACCOUNT_PUBLIC_ORIGIN=https://your-domain.example` to the exact origin without a
trailing slash. Secure cookies are enabled for production or an HTTPS public origin.
`ACCOUNT_COOKIE_SECURE=false` is available for local HTTP development. The default
app remains local until the server is deployed; registration alone does not publish
it online. No email verification, email delivery or password-reset service is provided.

Passwords are hashed asynchronously with scrypt (`N=131072`, `r=8`, `p=1`), independent
random salts and timing-safe comparison. At most two expensive hashes execute at
once. Authentication tokens are random 256-bit values, stored only as SHA-256 hashes,
expire after seven days and rotate on login. Account mutations require a matching
browser Origin and reject cross-site requests. Authentication rate limits persist
in SQLite. Existing anonymous video/camera guidance continues to work.

Each saved activity is unique to an account, input source and guidance reference.
Saving again updates that activity instead of increasing session metrics. Snapshots
are derived from guarded server state; client-supplied completion counts are rejected.
AI and operator confirmations remain separate. Visual-check metrics count retained
non-demo observations for that source/reference, not complete training time or
certified proficiency. Up to 500 activities and 2 MB per snapshot are retained.

Original video/audio bytes and original guidance documents are not copied into the
account. Evidence images are excluded by default and included only when the operator
explicitly selects `include_evidence_images: true`; the review's image-retention budget
still applies. The snapshot does contain source/document names, process descriptions,
operator wishes, recorded text evidence and decisions, so review this content before
saving or sharing a downloaded report.

Routes:

- `GET /api/account/me`: current public account or `null`.
- `POST /api/account/register`: `{name,email,password}`; requires a 12–128 character password.
- `POST /api/account/login`: `{email,password}`; rotates the current cookie.
- `POST /api/account/logout`: revokes the current cookie.
- `DELETE /api/account/me`: `{password,confirmation:"DELETE"}`; erases the account,
  all saved activities and all sign-in sessions.
- `GET /api/account/training`: owned history, separate confirmation metrics and
  the provenance notice.
- `POST /api/account/training/save`: `{source_id,reference_key,review_version,title?,include_evidence_images?}`.
- `GET /api/account/training/:id`: owned saved handoff snapshot.
- `GET /api/account/training/:id/report.pdf` and `/report.html`: owned standalone reports.
- `DELETE /api/account/training/:id`: erase one owned activity.

PDF delivery rechecks authentication and report ownership after rendering so a
concurrent logout or deletion cannot release a private report afterward.

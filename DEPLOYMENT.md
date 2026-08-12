# Deployment & Troubleshooting

## What was wrong

The pipeline ran green but the app never connected. Five separate causes:

| # | Problem | Effect |
|---|---|---|
| 1 | Frontend baked `VITE_API_URL` from `secrets.BACKEND_URL` at **build** time. If that secret was empty, the code fell back to `http://localhost:5048`. | Browser called the user's own machine. Requests fail with no server-side trace — the classic "deploys fine, won't connect". |
| 2 | Images pushed to `gcr.io`. Container Registry has been shut down in favour of Artifact Registry. | Pushes fail or land somewhere Cloud Run can't pull from. |
| 3 | `app.UseHttpsRedirection()` in `Program.cs`. | Cloud Run terminates TLS and forwards plain HTTP. ASP.NET sees `http` and can redirect or drop requests. |
| 4 | Mongo `env_vars` passed with the default comma delimiter. | A Mongo URI containing commas (replica-set host lists) is split into garbage variables. |
| 5 | Every endpoint was `[Authorize]`, with no health endpoint and no logging. | A bare `curl` returned 401 whether the backend was healthy, misconfigured, or unable to reach Atlas. Nothing was distinguishable. |

## How it works now

```
browser ──> Cloud Run frontend (nginx :8080)
              ├── /            → static React build
              └── /api, /health → proxy_pass $BACKEND_URL  (read at container START)
                                    │
                                    └──> Cloud Run backend (.NET :$PORT) ──> MongoDB Atlas
```

The browser only ever talks to one origin. That removes CORS entirely, and the
backend URL is a **runtime** env var on the frontend service — changing it is a
`gcloud run services update`, not a rebuild.

## Configuration reference

Run the provisioning script once and it does all of the GCP side for you:

```bash
./scripts/setup-gcp.sh <YOUR_PROJECT_ID>
```

It's idempotent — safe to re-run. It prompts for the Mongo URI and Google
client ID, stores them in Secret Manager, and prints the GitHub secrets to
paste.

### GitHub secrets — 4, and this is the only place you edit config

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | `my-project-123` |
| `GCP_SA_KEY` | The deployer service-account JSON key, whole file |
| `MONGODB_ATLAS_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority` |
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` |

**Delete `BACKEND_URL` if it still exists** — obsolete and actively misleading.
The workflow now derives it from the backend deploy step's output.

### Secret Manager — populated automatically

You never create these by hand. The preflight job's **"Sync GitHub secrets into
Secret Manager"** step mirrors them on every run:

| Secret name | Source | Consumed as |
|---|---|---|
| `mongodb-atlas-uri` | `MONGODB_ATLAS_URI` | `ChallengeStoreDatabase__ConnectionString` |
| `google-client-id` | `GOOGLE_CLIENT_ID` | `Google__ClientId` (backend) and `VITE_GOOGLE_CLIENT_ID` (frontend build) |

The sync creates the secret if absent, adds a new version **only when the value
changed** (so re-runs don't pile up identical versions), and grants the Cloud
Run runtime SA `secretAccessor` each time.

Why bother going through Secret Manager at all rather than plain env vars: the
Mongo URI never appears in the Cloud Run service YAML or the console, and
`--set-secrets` sidesteps the comma-delimiter bug that mangles replica-set host
lists in `env_vars`.

**To rotate anything:** change the GitHub secret and re-run the pipeline. That's
the whole procedure.

### APIs to enable

`run`, `artifactregistry`, `secretmanager`, `iam`, `logging`,
`cloudresourcemanager`.

### IAM — deployer service account

| Role | Why |
|---|---|
| `roles/run.admin` | Create/update services, set `allUsers` invoker |
| `roles/artifactregistry.admin` | Create the repo, push images |
| `roles/iam.serviceAccountUser` | Deploy a service that *runs as* the runtime SA |
| `roles/secretmanager.admin` | Create secrets, add versions, verify bindings |
| `roles/logging.viewer` | Dump logs when a job fails |

### IAM — Cloud Run runtime service account

`PROJECT_NUMBER-compute@developer.gserviceaccount.com` needs
`roles/secretmanager.secretAccessor` **on each secret**. Without it the
revision fails to start with a permission error on the secret — the preflight
job checks this explicitly and tells you the exact fix command.

### MongoDB Atlas

Cloud Run egress IPs are dynamic. Under **Network Access**, add `0.0.0.0/0`, or
set up a VPC connector with Cloud NAT and allowlist that static IP. This is the
single most common reason the backend deploys successfully and then fails every
request.

### What preflight catches before anything builds

Missing or malformed `GCP_SA_KEY`; a secret that doesn't exist, is empty, or
still holds a placeholder; a Mongo URI with the wrong scheme or pointing at
localhost; a client ID with the wrong suffix; and a runtime SA that can't read
the secrets.

## Diagnosing a broken deploy

### 1. Run the layered check

```bash
./scripts/diagnose.sh
```

It auto-discovers both URLs from gcloud and walks the path one layer at a time.
The **first** FAIL is the broken layer:

| Layer | Fails when |
|---|---|
| 1. `/health` | Container isn't starting or isn't listening on `$PORT` |
| 2. `/health/config` | Env vars never reached the container |
| 3. `/health/db` | Backend can't reach Atlas (URI or IP allowlist) |
| 4. frontend `/` | nginx isn't serving the build |
| 5. frontend `/health` | `BACKEND_URL` unset or wrong on the frontend service |
| 6. `/api/…` → 401 | Anything other than 401 means routing, not auth, is broken |
| 7. authenticated call | Google client ID mismatch between frontend and backend |

Add `TOKEN=<google_id_token>` to test authenticated calls too.

### 2. From the browser

Open the deployed app's console and run:

```js
__apiDiagnostics()
```

Prints a table of every layer as seen from the browser. Every API call also
logs its method, URL, status, and timing, with a targeted hint on 401/503.

### 3. Read the logs

```bash
gcloud run services logs read hundred-days-backend  --region us-central1 --limit 100
gcloud run services logs read hundred-days-frontend --region us-central1 --limit 100
```

The backend logs at startup which config landed (secrets redacted), every
request with status and duration, and the reason for every rejected JWT.
nginx logs each proxied request as JSON including `upstream_status`.

CI dumps both services' logs automatically when a job fails.

## Diagnostic endpoints

All anonymous, on the backend and reachable through the frontend origin:

| Path | Answers |
|---|---|
| `/health` | Is the container alive? |
| `/health/config` | Did the env vars arrive? (redacted) |
| `/health/db` | Can it reach Atlas, and how fast? |
| `/health/auth` | What claims does my token actually carry? |
| `/_frontend_health` | What is nginx proxying to? (frontend only) |

## Changing the backend URL

No rebuild needed:

```bash
gcloud run services update hundred-days-frontend \
  --region us-central1 \
  --set-env-vars BACKEND_URL=https://new-backend-xxxx.run.app
```

## Local development

```bash
docker compose up --build     # app on http://localhost:3000
```

Or without Docker:

```bash
cd backend && dotnet run                # http://localhost:5048
cd frontend && pnpm install && pnpm dev # Vite proxies /api to the backend
```

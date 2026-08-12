#!/usr/bin/env bash
# One-time GCP provisioning for the 100-days deploy pipeline.
#
# Idempotent — safe to re-run. Creates nothing that already exists.
#
#   ./scripts/setup-gcp.sh <PROJECT_ID>
#
# Prompts for the Mongo URI and Google client ID, stores them in Secret
# Manager, and prints the four GitHub secrets you need to paste.

set -euo pipefail

PROJECT_ID="${1:-${PROJECT_ID:-}}"
REGION="${REGION:-us-central1}"
AR_REPO="${AR_REPO:-hundred-days}"
SA_NAME="${SA_NAME:-github-deployer}"
BACKEND_SERVICE="${BACKEND_SERVICE:-hundred-days-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-hundred-days-frontend}"
# Default OUTSIDE the repo. Writing a service-account key into a git work tree
# is how it ends up committed — GitHub push protection will block the push, but
# only after the key is already in your local history.
KEY_OUT="${KEY_OUT:-${TMPDIR:-/tmp}/gcp-sa-key.json}"

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$BLUE" "$1" "$OFF"; }
ok()   { printf '%s  ok%s %s\n' "$GREEN" "$OFF" "$1"; }
note() { printf '%s     %s%s\n' "$DIM" "$1" "$OFF"; }
die()  { printf '%s  !! %s%s\n' "$RED" "$1" "$OFF" >&2; exit 1; }

[ -n "$PROJECT_ID" ] || die "Usage: $0 <PROJECT_ID>"
command -v gcloud >/dev/null || die "gcloud not found. Install the Google Cloud CLI first."

gcloud config set project "$PROJECT_ID" >/dev/null
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
# Cloud Run services run as this identity unless told otherwise. It is the
# account that must be able to READ the secrets at runtime.
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Project        : $PROJECT_ID ($PROJECT_NUMBER)"
echo "Region         : $REGION"
echo "Deployer SA    : $SA_EMAIL"
echo "Cloud Run SA   : $RUNTIME_SA"

# ---------------------------------------------------------------------------
step "1/6  Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project "$PROJECT_ID"
ok "APIs enabled"

# ---------------------------------------------------------------------------
step "2/6  Creating the deployer service account"
if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  ok "Service account already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions deployer (100 days)"
  ok "Created $SA_EMAIL"
fi

step "3/6  Granting roles to the deployer"
# run.admin           — create/update Cloud Run services and set allUsers IAM
# artifactregistry.admin — create the repo and push images
# iam.serviceAccountUser — required to deploy a service that runs AS $RUNTIME_SA
# secretmanager.admin — create secrets and add versions
# logging.viewer      — let the workflow dump logs when a job fails
for role in \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/secretmanager.admin \
  roles/logging.viewer
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None >/dev/null
  ok "$role"
done

# ---------------------------------------------------------------------------
step "4/6  Creating the Artifact Registry repository"
if gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  ok "Repo '$AR_REPO' already exists"
else
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Images for 100-days-doing-something"
  ok "Created repo '$AR_REPO'"
fi
note "Images will be pushed to ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/"

# ---------------------------------------------------------------------------
step "5/6  Application secrets"
note "Nothing to do here — the pipeline handles it."
note "The 'Sync GitHub secrets into Secret Manager' step in deploy.yml creates"
note "mongodb-atlas-uri and google-client-id from your GitHub secrets on every"
note "run, and grants ${RUNTIME_SA} read access."
ok "Skipped by design"

# ---------------------------------------------------------------------------
step "6/6  Creating a service-account key for GitHub"
# Refuse to write a credential anywhere git might pick it up.
KEY_DIR=$(cd "$(dirname "$KEY_OUT")" 2>/dev/null && pwd || echo "")
if [ -n "$KEY_DIR" ] && git -C "$KEY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "KEY_OUT ($KEY_OUT) is inside a git repository. Choose a path outside it, e.g. KEY_OUT=~/gcp-sa-key.json"
fi

if [ -f "$KEY_OUT" ]; then
  note "$KEY_OUT already exists — not overwriting."
else
  gcloud iam service-accounts keys create "$KEY_OUT" --iam-account="$SA_EMAIL"
  ok "Wrote $KEY_OUT"
fi

# ---------------------------------------------------------------------------
cat <<EOF

${GREEN}GCP setup complete.${OFF}

${BLUE}GitHub needs these 4 secrets${OFF}
  Repo → Settings → Secrets and variables → Actions → New repository secret

  GCP_PROJECT_ID      ${PROJECT_ID}
  GCP_SA_KEY          <entire contents of ${KEY_OUT}>
  MONGODB_ATLAS_URI   mongodb+srv://USER:PASS@cluster.mongodb.net/...
  GOOGLE_CLIENT_ID    ....apps.googleusercontent.com

  ${DIM}GitHub is the single source of truth. The pipeline mirrors the last two
  into Secret Manager on every run, so you never touch gcloud to change them.${OFF}

With the gh CLI:

  gh secret set GCP_PROJECT_ID --body "${PROJECT_ID}"
  gh secret set GCP_SA_KEY     < "${KEY_OUT}"
  gh secret set MONGODB_ATLAS_URI
  gh secret set GOOGLE_CLIENT_ID

${YELLOW}Then delete the local key file — it is a long-lived credential:${OFF}
  rm ${KEY_OUT}

${YELLOW}Delete this obsolete GitHub secret if it still exists:${OFF}
  gh secret delete BACKEND_URL

${YELLOW}Finally, MongoDB Atlas → Network Access:${OFF}
  Add 0.0.0.0/0. Cloud Run egress IPs are dynamic, so without this the backend
  deploys successfully and then fails every single request.

Verify after your next push:
  ./scripts/diagnose.sh
EOF

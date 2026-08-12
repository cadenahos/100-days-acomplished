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
KEY_OUT="${KEY_OUT:-./gcp-sa-key.json}"

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
step "5/6  Storing application secrets in Secret Manager"

# upsert_secret <name> <prompt> [silent]
upsert_secret() {
  local name="$1" prompt="$2" silent="${3:-}" value=""

  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '  Secret %s already exists. Add a new version? [y/N] ' "$name"
    read -r reply </dev/tty
    case "$reply" in
      y|Y) ;;
      *) ok "Kept existing $name"; return ;;
    esac
  else
    gcloud secrets create "$name" --replication-policy=automatic >/dev/null
    note "Created secret container $name"
  fi

  if [ -n "$silent" ]; then
    printf '  %s: ' "$prompt"; read -rs value </dev/tty; echo
  else
    printf '  %s: ' "$prompt"; read -r value </dev/tty
  fi
  [ -n "$value" ] || die "Empty value for $name"

  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
  ok "Stored a new version of $name"
}

echo "  Mongo URI format: mongodb+srv://USER:PASS@cluster.mongodb.net/HundredDaysDb?retryWrites=true&w=majority"
upsert_secret "mongodb-atlas-uri" "MongoDB Atlas connection URI" silent
upsert_secret "google-client-id"  "Google OAuth client ID (…apps.googleusercontent.com)"

# The Cloud Run runtime identity must be able to read the secret values.
# Missing this is the #1 cause of a revision that fails to start with a
# "Permission denied on secret" error.
for secret in mongodb-atlas-uri google-client-id; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
  ok "Cloud Run can read $secret"
done

# ---------------------------------------------------------------------------
step "6/6  Creating a service-account key for GitHub"
if [ -f "$KEY_OUT" ]; then
  note "$KEY_OUT already exists — not overwriting."
else
  gcloud iam service-accounts keys create "$KEY_OUT" --iam-account="$SA_EMAIL"
  ok "Wrote $KEY_OUT"
fi

# ---------------------------------------------------------------------------
cat <<EOF

${GREEN}GCP setup complete.${OFF}

${BLUE}GitHub needs exactly 2 secrets${OFF}
  Repo → Settings → Secrets and variables → Actions → New repository secret

  GCP_PROJECT_ID      ${PROJECT_ID}
  GCP_SA_KEY          <entire contents of ${KEY_OUT}>

  ${DIM}That is all. The Mongo URI and Google client ID now live only in Secret
  Manager — the workflow reads them from GCP, so there is nothing to keep in
  sync between GitHub and GCP.${OFF}

With the gh CLI:

  gh secret set GCP_PROJECT_ID --body "${PROJECT_ID}"
  gh secret set GCP_SA_KEY     < "${KEY_OUT}"

${YELLOW}Then delete the local key file — it is a long-lived credential:${OFF}
  rm ${KEY_OUT}

${YELLOW}Delete these now-obsolete GitHub secrets if they exist:${OFF}
  gh secret delete BACKEND_URL
  gh secret delete MONGODB_ATLAS_URI
  gh secret delete GOOGLE_CLIENT_ID

${YELLOW}Finally, MongoDB Atlas → Network Access:${OFF}
  Add 0.0.0.0/0. Cloud Run egress IPs are dynamic, so without this the backend
  deploys successfully and then fails every single request.

Verify after your next push:
  ./scripts/diagnose.sh
EOF

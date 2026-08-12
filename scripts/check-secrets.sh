#!/usr/bin/env bash
# Tests each credential BY USING IT, so you find out which one is actually
# broken instead of guessing. GitHub secrets cannot be read back, so this is
# the only way to verify them: paste the same values here and see what fails.
#
#   ./scripts/check-secrets.sh
#
# Nothing is written anywhere and nothing is uploaded. Values are read into
# memory, tested, and discarded. Run it from a trusted machine.

set -uo pipefail

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
FAILURES=0
pass() { printf '%s  PASS%s  %s\n' "$GREEN" "$OFF" "$1"; }
fail() { printf '%s  FAIL%s  %s\n' "$RED" "$OFF" "$1"; FAILURES=$((FAILURES+1)); }
warn() { printf '%s  WARN%s  %s\n' "$YELLOW" "$OFF" "$1"; }
info() { printf '%s        %s%s\n' "$DIM" "$1" "$OFF"; }
head2(){ printf '\n%s== %s ==%s\n' "$BLUE" "$1" "$OFF"; }

TMPDIR_SELF=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_SELF"; }
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 1. SA key
head2 "1. GCP_SA_KEY — service account JSON"
printf '  Path to your service-account JSON key file (blank to skip): '
read -r KEYFILE </dev/tty

SA_OK=0
if [ -z "$KEYFILE" ]; then
  warn "Skipped."
elif [ ! -f "$KEYFILE" ]; then
  fail "No such file: $KEYFILE"
elif ! jq -e '.client_email and .private_key and .project_id' "$KEYFILE" >/dev/null 2>&1; then
  fail "Not valid service-account JSON — needs client_email, private_key, project_id."
  info "A common mistake is pasting only part of the file, or pasting a"
  info "downloaded OAuth client secret instead of a service-account key."
else
  SA_EMAIL=$(jq -r .client_email "$KEYFILE")
  KEY_PROJECT=$(jq -r .project_id "$KEYFILE")
  pass "Valid JSON — $SA_EMAIL (project: $KEY_PROJECT)"
  SA_OK=1
fi

# ---------------------------------------------------------------- 2. project
head2 "2. GCP_PROJECT_ID"
printf '  GCP_PROJECT_ID value (blank to use the key'\''s project_id): '
read -r PROJECT_ID </dev/tty
[ -z "$PROJECT_ID" ] && PROJECT_ID="${KEY_PROJECT:-}"

if [ -z "$PROJECT_ID" ]; then
  fail "No project ID available."
elif [ "$SA_OK" = "1" ] && [ "$PROJECT_ID" != "$KEY_PROJECT" ]; then
  fail "GCP_PROJECT_ID ('$PROJECT_ID') does not match the key's project ('$KEY_PROJECT')."
  info "The deploy will authenticate fine and then fail to find your resources."
else
  pass "Project ID = $PROJECT_ID"
fi

# ------------------------------------------------------- 3. can it authenticate
head2 "3. Does that key actually work, and can it do what the pipeline needs?"
if [ "$SA_OK" = "1" ] && command -v gcloud >/dev/null 2>&1; then
  export CLOUDSDK_CONFIG="$TMPDIR_SELF/gcloud"   # don't disturb your real login
  if gcloud auth activate-service-account --key-file="$KEYFILE" >/dev/null 2>&1; then
    pass "Key authenticates to GCP"

    for perm_pair in \
      "run.services.create:deploy Cloud Run services" \
      "artifactregistry.repositories.uploadArtifacts:push images" \
      "secretmanager.versions.access:read secrets" \
      "iam.serviceAccounts.actAs:deploy as the runtime SA" \
      "logging.logEntries.list:read logs on failure"
    do
      perm="${perm_pair%%:*}"; label="${perm_pair#*:}"
      result=$(gcloud projects test-iam-permissions "$PROJECT_ID" \
                 --permissions="$perm" --format='value(permissions)' 2>/dev/null)
      if [ "$result" = "$perm" ]; then
        pass "can $label"
      else
        fail "CANNOT $label  (missing $perm)"
      fi
    done
  else
    fail "Key does NOT authenticate. It may be disabled, deleted, or from a different project."
    info "Check: gcloud iam service-accounts keys list --iam-account=$SA_EMAIL"
  fi
elif ! command -v gcloud >/dev/null 2>&1; then
  warn "gcloud not installed — skipping live permission checks."
else
  warn "Skipped (no valid key)."
fi

# ---------------------------------------------------------------- 4. mongo
head2 "4. MONGODB_ATLAS_URI — can it actually connect?"
printf '  Paste the Mongo URI (hidden, blank to skip): '
read -rs MONGO_URI </dev/tty; echo

if [ -z "$MONGO_URI" ]; then
  warn "Skipped."
else
  case "$MONGO_URI" in
    mongodb://*|mongodb+srv://*) pass "Scheme is valid" ;;
    *) fail "Must start with mongodb:// or mongodb+srv://" ;;
  esac
  case "$MONGO_URI" in
    *localhost*|*127.0.0.1*) fail "Points at localhost — Cloud Run has no local Mongo." ;;
  esac
  case "$MONGO_URI" in
    *"<"*|*">"*) fail "Still contains placeholder brackets like <password>." ;;
  esac
  # An unencoded @ or : in the password splits the URI at the wrong place.
  creds="${MONGO_URI#*://}"; creds="${creds%%@*}"
  case "$creds" in
    *:*) userpart="${creds%%:*}"; passpart="${creds#*:}"
         case "$passpart" in
           *[@/:\#\?]*) fail "Password contains an unencoded special char. URL-encode it (@ = %40, # = %23, / = %2F, : = %3A)." ;;
           *) pass "Credential section looks correctly encoded (user: $userpart)" ;;
         esac ;;
  esac
  case "$MONGO_URI" in
    *$'\n'*) fail "Contains a newline — you probably used 'echo' instead of 'printf'." ;;
  esac

  # Live connection test.
  if command -v mongosh >/dev/null 2>&1; then
    if mongosh "$MONGO_URI" --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1; then
      pass "Connected to Atlas successfully"
    else
      fail "Could NOT connect to Atlas with this URI"
      info "Usual causes: wrong password, user lacks readWrite, or your IP"
      info "is not in Atlas Network Access. Note your laptop's IP differs from"
      info "Cloud Run's — allow 0.0.0.0/0 for Cloud Run to work."
    fi
  elif command -v python3 >/dev/null 2>&1 && python3 -c 'import pymongo' 2>/dev/null; then
    if MONGO_URI="$MONGO_URI" python3 - <<'PY'
import os, sys
from pymongo import MongoClient
try:
    MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=10000).admin.command("ping")
except Exception as e:
    print(f"    {type(e).__name__}: {str(e)[:200]}", file=sys.stderr); sys.exit(1)
PY
    then pass "Connected to Atlas successfully"
    else fail "Could NOT connect to Atlas with this URI"; fi
  else
    warn "No mongosh or pymongo — shape checked only, connection not tested."
    info "Install one: brew install mongosh    |    pip install pymongo"
  fi
fi
unset MONGO_URI

# ---------------------------------------------------------------- 5. client id
head2 "5. GOOGLE_CLIENT_ID"
printf '  Paste the Google client ID (blank to skip): '
read -r CID </dev/tty

if [ -z "$CID" ]; then
  warn "Skipped."
else
  case "$CID" in
    *.apps.googleusercontent.com) pass "Suffix is correct" ;;
    *) fail "Should end in .apps.googleusercontent.com" ;;
  esac
  case "$CID" in
    *GOCSPX-*|*secret*) fail "This looks like a client SECRET, not a client ID." ;;
  esac
  info "Shape is all that can be checked offline. The real test is whether"
  info "your frontend's Cloud Run URL is listed under 'Authorized JavaScript"
  info "origins' for this client in APIs & Services → Credentials."
fi

# ---------------------------------------------------------------- summary
echo
if [ "$FAILURES" -eq 0 ]; then
  printf '%sNo problems found in the values you supplied.%s\n' "$GREEN" "$OFF"
  echo "If the pipeline still fails, the value in GitHub differs from what you"
  echo "just pasted. Re-set it — you cannot read it back to compare."
else
  printf '%s%d problem(s) found — those are your failing secrets.%s\n' "$RED" "$FAILURES" "$OFF"
fi
exit $(( FAILURES > 0 ? 1 : 0 ))

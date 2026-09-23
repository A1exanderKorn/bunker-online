#!/usr/bin/env bash
# Run as the checkout owner. Requires Git, Docker Engine and Compose v2.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p .deploy
exec 9>.deploy/lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[[ $(git branch --show-current) == master ]] || { echo 'Checkout must be on master.' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Commit or remove local checkout changes first.' >&2; exit 1; }
git fetch origin master
git merge --ff-only origin/master
[[ $(git rev-parse HEAD) == $(git rev-parse origin/master) ]] || { echo 'Local master differs from origin/master.' >&2; exit 1; }

sha=$(git rev-parse HEAD)
previous=$(sudo docker inspect bunker-online-app-1 --format '{{.Config.Image}}' 2>/dev/null || true)
export BUNKER_IMAGE="bunker-online:$sha"
sudo --preserve-env=BUNKER_IMAGE docker compose config --quiet
# Build before replacing the running application. Build failure leaves it running.
sudo --preserve-env=BUNKER_IMAGE docker compose build app
if sudo --preserve-env=BUNKER_IMAGE docker compose up -d --wait --wait-timeout 120; then
    printf '%s\n' "$BUNKER_IMAGE" > .deploy/current-image
    if [[ -n "$previous" && "$previous" != "$BUNKER_IMAGE" ]]; then
        printf '%s\n' "$previous" > .deploy/previous-image
    fi
    echo "Deployed master at $sha"
else
    echo 'Deployment failed; showing recent logs.' >&2
    sudo docker compose logs --tail=80 app proxy || true
    if [[ -n "$previous" ]]; then
        export BUNKER_IMAGE="$previous"
        sudo --preserve-env=BUNKER_IMAGE docker compose up -d --no-build --wait --wait-timeout 120
        echo "Restored previous application image: $previous" >&2
    fi
    exit 1
fi

#!/usr/bin/env bash
# Claude Code otelHeadersHelper: prints the Access headers from the reporter's env file as JSON.
set -euo pipefail
env_file="${XDG_CONFIG_HOME:-$HOME/.config}/lyjwpage/omarchy-reporter.env"
id=$(sed -n 's/^ACCESS_CLIENT_ID=//p' "$env_file" | tail -1)
secret=$(sed -n 's/^ACCESS_CLIENT_SECRET=//p' "$env_file" | tail -1)
jq -cn --arg id "$id" --arg secret "$secret" '{"CF-Access-Client-Id": $id, "CF-Access-Client-Secret": $secret}'

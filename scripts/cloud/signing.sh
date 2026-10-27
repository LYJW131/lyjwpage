#!/bin/bash
set -euo pipefail

: "${AAPAY_SIGN_KEY_B64:?set AAPAY_SIGN_KEY_B64 (base64 of the commit-signing private key) at the top of the environment setup script}"
: "${GIT_SIGN_NAME:?set GIT_SIGN_NAME at the top of the environment setup script}"
: "${GIT_SIGN_EMAIL:?set GIT_SIGN_EMAIL at the top of the environment setup script}"

if ! command -v ssh-keygen >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -q openssh-client >/dev/null 2>&1 \
    || { apt-get update -q >/dev/null && apt-get install -y -q openssh-client >/dev/null; }
fi

install -d -m 700 /root/.ssh
( umask 077; printf '%s' "$AAPAY_SIGN_KEY_B64" | base64 -d > /root/.ssh/aapay_sign )
chmod 600 /root/.ssh/aapay_sign
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFkqMwdzFkdjcwkdmvc0K6vxqGZqq7Ebkhwmr1zwYIam aapay-commit-signing" > /root/.ssh/aapay_sign.pub

git config --global user.name "$GIT_SIGN_NAME"
git config --global user.email "$GIT_SIGN_EMAIL"
git config --global gpg.format ssh
git config --global gpg.ssh.program ssh-keygen
git config --global user.signingkey /root/.ssh/aapay_sign.pub
git config --global commit.gpgsign true

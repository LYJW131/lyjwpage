#!/bin/bash
set -euo pipefail

: "${GIT_SIGN_KEY_B64:?set GIT_SIGN_KEY_B64 (base64 of the commit-signing private key) at the top of the environment setup script}"
: "${GIT_SIGN_NAME:?set GIT_SIGN_NAME at the top of the environment setup script}"
: "${GIT_SIGN_EMAIL:?set GIT_SIGN_EMAIL at the top of the environment setup script}"

if ! command -v ssh-keygen >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -q openssh-client >/dev/null 2>&1 \
    || { apt-get update -q >/dev/null && apt-get install -y -q openssh-client >/dev/null; }
fi

install -d -m 700 /root/.ssh
( umask 077; printf '%s' "$GIT_SIGN_KEY_B64" | base64 -d > /root/.ssh/git_sign.tmp )
ssh-keygen -y -f /root/.ssh/git_sign.tmp > /root/.ssh/git_sign.pub
mv /root/.ssh/git_sign.tmp /root/.ssh/git_sign

git config --global user.name "$GIT_SIGN_NAME"
git config --global user.email "$GIT_SIGN_EMAIL"
git config --global gpg.format ssh
git config --global gpg.ssh.program ssh-keygen
git config --global user.signingkey /root/.ssh/git_sign.pub
git config --global commit.gpgsign true

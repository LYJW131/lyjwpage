import type { AppleMusicCredentialsResult } from "@shared/credentials";

export type AppleMusicAuth = {
  developerToken(): Promise<string>;
  credentials(): Promise<AppleMusicCredentialsResult>;
};

let auth: AppleMusicAuth | null = null;

export function installAppleMusicAuth(next: AppleMusicAuth | null): void {
  auth = next;
}

function installed(): AppleMusicAuth {
  if (!auth) throw new Error("Apple Music 凭据没有装上：Worker 入口先调 installAppleMusicAuth");
  return auth;
}

export function appleDeveloperToken(): Promise<string> {
  return installed().developerToken();
}

export function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  return installed().credentials();
}

import { BUILD_REPO } from "@shared/build-routine";
import { base64url } from "../../crypto";
import { ACTIONS_OIDC_ISSUER, ACTIONS_OIDC_JWKS_URL, BUILD_REPO_ID, BUILD_REPO_OWNER_ID, BUILD_WORKFLOW_REF } from "../actions-oidc";

type SigningKey = { kid: string; privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

async function signingKey(kid: string): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"]) as CryptoKeyPair;
  const { n, e } = await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { kty: "RSA", n, e, kid, alg: "RS256", use: "sig" } };
}

export function actionsClaims(audience: string, now = Date.now()): Record<string, unknown> {
  const iat = Math.floor(now / 1000);
  return {
    iss: ACTIONS_OIDC_ISSUER, aud: audience, sub: `repo:${BUILD_REPO}:ref:refs/heads/main`, repository: BUILD_REPO, repository_id: BUILD_REPO_ID, repository_owner: BUILD_REPO.split("/")[0], repository_owner_id: BUILD_REPO_OWNER_ID,
    ref: "refs/heads/main", event_name: "repository_dispatch", workflow_ref: BUILD_WORKFLOW_REF, job_workflow_ref: BUILD_WORKFLOW_REF,
    runner_environment: "github-hosted", run_id: "1", run_attempt: "1", iat, nbf: iat - 600, exp: iat + 300,
  };
}

export type ActionsOidcFixture = {
  readonly kid: string;
  readonly jwksRequests: number;
  jwksStatus: number;
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
  token(audience: string, patch?: Record<string, unknown>, now?: number): Promise<string>;
  rotate(keepPrevious?: boolean): Promise<void>;
  serve(next?: typeof fetch): typeof fetch;
};

export async function createActionsOidcFixture(): Promise<ActionsOidcFixture> {
  let generation = 1;
  let keys = [await signingKey(`fixture-${generation}`)];
  let jwksRequests = 0;
  const fixture: ActionsOidcFixture = {
    get kid() { return keys[0].kid; },
    get jwksRequests() { return jwksRequests; },
    jwksStatus: 200,
    async sign(claims, header = {}) {
      const body = `${encode({ alg: "RS256", typ: "JWT", kid: keys[0].kid, ...header })}.${encode(claims)}`;
      const signature = await crypto.subtle.sign(RSA, keys[0].privateKey, new TextEncoder().encode(body));
      return `${body}.${base64url(new Uint8Array(signature))}`;
    },
    token(audience, patch = {}, now = Date.now()) {
      return fixture.sign({ ...actionsClaims(audience, now), ...patch });
    },
    async rotate(keepPrevious = false) {
      generation += 1;
      const next = await signingKey(`fixture-${generation}`);
      keys = keepPrevious ? [next, ...keys] : [next];
    },
    serve(next) {
      return async (input, init) => {
        if (String(input) !== ACTIONS_OIDC_JWKS_URL) {
          if (!next) throw new Error(`Unexpected request in the OIDC fixture: ${String(input)}`);
          return next(input, init);
        }
        jwksRequests += 1;
        return fixture.jwksStatus === 200 ? Response.json({ keys: keys.map((key) => key.jwk) }) : Response.json({ message: "unavailable" }, { status: fixture.jwksStatus });
      };
    },
  };
  return fixture;
}

export function pastHalfLife(token: { issuedAt: number; expiresAt: number }, now: number): boolean {
  return now >= token.issuedAt + (token.expiresAt - token.issuedAt) / 2;
}

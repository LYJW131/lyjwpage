/** 相对签发时刻判断过半寿命，令牌 TTL 改变时无需另设提前量；三个时刻使用同一单位。 */
export function pastHalfLife(token: { issuedAt: number; expiresAt: number }, now: number): boolean {
  return now >= token.issuedAt + (token.expiresAt - token.issuedAt) / 2;
}

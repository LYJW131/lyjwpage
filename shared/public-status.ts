export interface PublicStatusRpc {
  readStatus(path: string): Promise<Response>;
}

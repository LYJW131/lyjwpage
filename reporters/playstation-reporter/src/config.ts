import type { Env } from "./env.js";
import type { StateStore } from "./store.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export const config = {
  dataDir: optional("DATA_DIR") ?? "/data",
  get ps5Host(): string {
    return required("PS5_HOST");
  },
  probeTimeoutMs: 1_500,
  env(state: StateStore): Env {
    return {
      STATE: state,
      SITE_INGEST_URL: required("SITE_INGEST_URL"),
      ACCESS_CLIENT_ID: required("ACCESS_CLIENT_ID"),
      ACCESS_CLIENT_SECRET: required("ACCESS_CLIENT_SECRET"),
      PSN_LANGUAGE: optional("PSN_LANGUAGE"),
      PSN_ACCOUNT_ID: optional("PSN_ACCOUNT_ID"),
      PLAYED_GAMES_LIMIT: optional("PLAYED_GAMES_LIMIT"),
      PLAYSTATION_HIDDEN_TITLE_IDS: optional("PLAYSTATION_HIDDEN_TITLE_IDS"),
      PS_DRY_RUN: optional("PS_DRY_RUN"),
      PSN_NPSSO: optional("PSN_NPSSO"),
    };
  },
};

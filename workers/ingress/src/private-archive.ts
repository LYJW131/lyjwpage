import { siteDay, type HistoryDb, type HistoryStatement } from "@shared/history-ingest";
import type { PreparedIngest } from "@shared/ingest/prepare";
import type { PrivateFacts } from "@shared/ingest/private";

type Prepared<S extends PreparedIngest["source"]> = Extract<PreparedIngest, { source: S }>;

const MINUTE_MS = 60_000;
const JSON_ROWS_PER_STATEMENT = 500;
// Emby 的 tick 是 100 纳秒。
const EMBY_TICKS_PER_MS = 10_000;

const INSERT_WATCHING_EVENT = `INSERT OR IGNORE INTO watching_events(observed_at, item_id, title, subtitle, paused,
    position_ms, runtime_ms, client, device, play_method, media)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_PLAY_SNAPSHOTS = `INSERT OR IGNORE INTO game_play_snapshots(title_id, play_duration_ms, play_count,
    last_played_at, name, observed_at)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
    json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]') FROM json_each(?)`;

const UPSERT_TROPHY_PROFILE = `INSERT INTO trophy_profile_days(date, level, level_progress, trophy_points,
    platinum, gold, silver, bronze, observed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET level = excluded.level, level_progress = excluded.level_progress,
    trophy_points = excluded.trophy_points, platinum = excluded.platinum, gold = excluded.gold,
    silver = excluded.silver, bronze = excluded.bronze, observed_at = excluded.observed_at
  WHERE excluded.observed_at >= trophy_profile_days.observed_at`;

const UPSERT_QUEST_ACTIVITY = `INSERT INTO quest_activities(started_at, title_key, details, state, name,
    first_seen_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(started_at, title_key, details, state) DO UPDATE SET name = excluded.name,
    first_seen_at = MIN(quest_activities.first_seen_at, excluded.first_seen_at),
    last_seen_at = MAX(quest_activities.last_seen_at, excluded.last_seen_at)`;

const INSERT_HOMEPOD_EVENT = `INSERT OR IGNORE INTO homepod_events(entity_id, observed_at, state, title, artist, album,
    position_ms, duration_ms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_POWERBANK_MINUTE = `INSERT INTO powerbank_minutes(minute_at, connected, battery_percent, charging,
    health_percent, input_w, output_w, temperature_c, thermal_limited, observed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(minute_at) DO UPDATE SET connected = excluded.connected, battery_percent = excluded.battery_percent,
    charging = excluded.charging, health_percent = excluded.health_percent, input_w = excluded.input_w,
    output_w = excluded.output_w, temperature_c = excluded.temperature_c, thermal_limited = excluded.thermal_limited,
    observed_at = excluded.observed_at
  WHERE excluded.observed_at >= powerbank_minutes.observed_at`;

const UPSERT_PORT_MINUTE = `INSERT INTO charging_port_minutes(minute_at, port, watts, volts, amps, protocol, cable,
    device, observed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(minute_at, port) DO UPDATE SET watts = excluded.watts, volts = excluded.volts, amps = excluded.amps,
    protocol = excluded.protocol, cable = excluded.cable, device = excluded.device, observed_at = excluded.observed_at
  WHERE excluded.observed_at >= charging_port_minutes.observed_at`;

const INSERT_DESKTOP_CHANGE = `INSERT OR IGNORE INTO desktop_changes(t, application, bundle_id, window_title)
  VALUES (?, ?, ?, ?)`;
const INSERT_TIMEZONE_CHANGE = `INSERT OR IGNORE INTO timezone_changes(t, identifier, abbreviation, seconds_from_gmt)
  VALUES (?, ?, ?, ?)`;
const INSERT_FOCUS_CHANGE = "INSERT OR IGNORE INTO focus_changes(t, mode) VALUES (?, ?)";

const UPSERT_SERVER_IDENTITY = `INSERT INTO server_identity(host, public_ip, os, kernel, country, city, isp, asn,
    asn_org, first_seen_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(host, public_ip, os, kernel) DO UPDATE SET country = excluded.country, city = excluded.city,
    isp = excluded.isp, asn = excluded.asn, asn_org = excluded.asn_org,
    first_seen_at = MIN(server_identity.first_seen_at, excluded.first_seen_at),
    last_seen_at = MAX(server_identity.last_seen_at, excluded.last_seen_at)`;

const minuteOf = (at: number) => Math.floor(at / MINUTE_MS) * MINUTE_MS;
const flag = (value: boolean) => (value ? 1 : 0);

function embyStatements(db: HistoryDb, command: Prepared<"emby">): HistoryStatement[] {
  const playing = command.playing;
  if (!playing) return [];
  const state = playing.state;
  return [db.prepare(INSERT_WATCHING_EVENT).bind(
    command.receivedAt,
    state?.itemId ?? null,
    playing.item?.title ?? null,
    playing.item?.subtitle || null,
    state ? flag(state.paused) : null,
    state ? Math.round(state.positionTicks / EMBY_TICKS_PER_MS) : null,
    state ? Math.round(state.runTimeTicks / EMBY_TICKS_PER_MS) : null,
    state?.client ?? null,
    state?.deviceName ?? null,
    state?.playMethod ?? null,
    state?.media ? JSON.stringify(state.media) : null,
  )];
}

// 已玩列表只带最近的一段，奖杯信封里也有累计时长，两边都收，同一时长只留先到的那行。
// 奖杯条目对应多个 titleId 时时长是几版之和，和单版的数对不上，不收。
function playstationStatements(db: HistoryDb, command: Prepared<"playstation">): HistoryStatement[] {
  const rows: unknown[][] = [];
  const { playedGames: played, trophies } = command;
  if (played) {
    for (const game of played.items) {
      if (game.playDurationMs == null) continue;
      rows.push([game.titleId, game.playDurationMs, game.playCount, game.lastPlayedAt, game.name, played.observedAt]);
    }
  }
  if (trophies) {
    for (const title of trophies.titles) {
      const [titleId, ...others] = title.titleIds;
      if (!titleId || others.length || title.playDurationMs == null) continue;
      rows.push([titleId, title.playDurationMs, title.playCount, title.lastPlayedAt, title.localizedName ?? title.name,
        trophies.observedAt]);
    }
  }
  const statements: HistoryStatement[] = [];
  for (let at = 0; at < rows.length; at += JSON_ROWS_PER_STATEMENT) {
    statements.push(db.prepare(INSERT_PLAY_SNAPSHOTS).bind(JSON.stringify(rows.slice(at, at + JSON_ROWS_PER_STATEMENT))));
  }
  if (trophies) {
    const { profile } = trophies;
    statements.push(db.prepare(UPSERT_TROPHY_PROFILE).bind(
      siteDay(trophies.observedAt),
      profile.level,
      profile.levelProgress,
      profile.trophyPoint,
      profile.earned.platinum,
      profile.earned.gold,
      profile.earned.silver,
      profile.earned.bronze,
      trophies.observedAt,
    ));
  }
  return statements;
}

// Discord 没给开局时刻时 started_at 记 0：同一款游戏、同一段状态文字的几次游玩会并成一行。
function questStatements(db: HistoryDb, command: Prepared<"quest">): HistoryStatement[] {
  const { playing, observedAt } = command.presence;
  if (!playing) return [];
  return [db.prepare(UPSERT_QUEST_ACTIVITY).bind(
    playing.startedAt ?? 0,
    playing.applicationId ?? playing.name,
    playing.details ?? "",
    playing.state ?? "",
    playing.name,
    observedAt,
    observedAt,
  )];
}

function homepodStatements(db: HistoryDb, command: Prepared<"homepod">, facts: PrivateFacts | null): HistoryStatement[] {
  if (facts?.source !== "homepod") return [];
  const { music } = command.stored;
  return [db.prepare(INSERT_HOMEPOD_EVENT).bind(
    facts.entityId,
    music.observedAt,
    music.state,
    music.title,
    music.artist,
    music.album,
    music.positionMs,
    music.durationMs,
  )];
}

function macStatements(db: HistoryDb, command: Prepared<"mac">): HistoryStatement[] {
  const { chargingDevices, desktop, timezone } = command.modules;
  const statements: HistoryStatement[] = [];
  const powerBank = chargingDevices?.powerBank;
  if (powerBank) {
    const at = powerBank.updatedAt ?? command.receivedAt;
    statements.push(db.prepare(UPSERT_POWERBANK_MINUTE).bind(
      minuteOf(at),
      flag(powerBank.connected),
      powerBank.battery,
      flag(powerBank.charging),
      powerBank.batteryHealth,
      powerBank.inputPower,
      powerBank.outputPower,
      powerBank.temperatures.length ? Math.max(...powerBank.temperatures) : null,
      flag(powerBank.thermalLimited),
      at,
    ));
  }
  const charger = chargingDevices?.charger;
  if (charger) {
    const at = charger.updatedAt ?? command.receivedAt;
    for (const port of charger.ports) {
      if (!port.active) continue;
      statements.push(db.prepare(UPSERT_PORT_MINUTE).bind(
        minuteOf(at), port.id, port.power, port.voltage, port.current, port.protocol, port.cable, port.device, at,
      ));
    }
  }
  const activity = desktop?.activity;
  if (activity) {
    statements.push(db.prepare(INSERT_DESKTOP_CHANGE).bind(
      activity.observedAt, activity.applicationName, activity.bundleIdentifier, activity.windowTitle,
    ));
  }
  if (timezone) {
    statements.push(db.prepare(INSERT_TIMEZONE_CHANGE).bind(
      timezone.observedAt, timezone.identifier, timezone.abbreviation, timezone.secondsFromGMT,
    ));
  }
  return statements;
}

function serverStatements(db: HistoryDb, command: Prepared<"server">): HistoryStatement[] {
  const { status } = command;
  return [db.prepare(UPSERT_SERVER_IDENTITY).bind(
    status.hostname,
    status.publicIp,
    status.os,
    status.kernel,
    status.country,
    status.city,
    status.isp,
    status.asn,
    status.asnOrg,
    status.observedAt,
    status.observedAt,
  )];
}

export function privateStatements(db: HistoryDb, command: PreparedIngest, facts: PrivateFacts | null): HistoryStatement[] {
  switch (command.source) {
    case "emby": return embyStatements(db, command);
    case "playstation": return playstationStatements(db, command);
    case "quest": return questStatements(db, command);
    case "homepod": return homepodStatements(db, command, facts);
    case "mac": return macStatements(db, command);
    case "iphone":
      return command.focus
        ? [db.prepare(INSERT_FOCUS_CHANGE).bind(command.focus.observedAt, command.focus.mode)]
        : [];
    case "server": return serverStatements(db, command);
    default: return [];
  }
}

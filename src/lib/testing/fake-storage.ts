import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";

type Entry = { kind: "string" | "hash" | "list"; value: string | Record<string, string> | string[]; expiresAt?: number };

export class FakeStorage extends StorageClient {
  private unreachable = false;
  private failing: ((commands: readonly StorageCommand[]) => boolean) | null = null;
  private entries = new Map<string, Entry>();
  constructor() { super(async (commands) => this.executeCommands(commands)); }
  setUnreachable(value = true): void { this.unreachable = value; }
  failWhen(predicate: ((commands: readonly StorageCommand[]) => boolean) | null): void { this.failing = predicate; }
  async append(key: string, ...values: string[]): Promise<number> { return this.executeCommands([{ op: "append", key, values }])[0] as number; }
  private executeCommands(commands: StorageCommand[]): unknown[] {
    if (this.unreachable) throw new Error("fake storage unreachable");
    if (this.failing?.(commands)) throw new Error("fake storage injected failure");
    const saved = structuredClone(this.entries);
    try { return commands.map((command) => this.command(command)); }
    catch (error) { this.entries = saved; throw error; }
  }
  private entry(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) { this.entries.delete(key); return; }
    return entry;
  }
  private command(command: StorageCommand): unknown {
    const { key } = command;
    let entry = this.entry(key);
    switch (command.op) {
      case "get": return entry?.value ?? null;
      case "set":
        if (entry && command.options?.ifAbsent) return false;
        this.entries.set(key, { kind: "string", value: command.value, expiresAt: command.options?.ttlMs ? Date.now() + command.options.ttlMs : undefined });
        return true;
      case "remove": return this.entries.delete(key) ? 1 : 0;
      case "expire": if (!entry) return 0; entry.expiresAt = Date.now() + command.ttlMs; return 1;
      case "fields": return entry?.value ?? {};
      case "patch":
        this.entries.set(key, { ...entry, kind: "hash", value: { ...(entry?.value as Record<string, string> ?? {}), ...command.fields } });
        return Object.keys(command.fields).length;
      case "append": {
        if (!entry) { entry = { kind: "list", value: [] }; this.entries.set(key, entry); }
        const list = entry.value as string[];
        list.push(...command.values);
        return list.length;
      }
      case "listRange": case "trim": {
        const list = entry?.value as string[] ?? [];
        const from = command.start < 0 ? Math.max(list.length + command.start, 0) : command.start;
        const to = command.stop < 0 ? list.length + command.stop : Math.min(command.stop, list.length - 1);
        const sliced = list.slice(from, Math.max(from, to + 1));
        if (command.op === "listRange") return sliced;
        if (entry) entry.value = sliced;
        return true;
      }
    }
  }
}

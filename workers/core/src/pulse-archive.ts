import { archiveStatements } from "./pulse-archive-statements";
import { reason, type PulseArchiveCoordinator, type PulseArchiveDb, type PulseArchiveSnapshot } from "./pulse-archive-snapshot";

export {
  ARCHIVE_STREAMS,
  siteDate,
  siteDayStart,
  type ArchiveSql,
  type ArchiveStream,
  type PulseArchiveCoordinator,
  type PulseArchiveDb,
  type PulseArchiveSnapshot,
  type PulseArchiveStreamSnapshot,
} from "./pulse-archive-snapshot";
export { PulseArchiveState } from "./pulse-archive-state";
export { activeSecondsByDay, archiveStatements } from "./pulse-archive-statements";

const CHUNK_SIZE = 100;

export class PulseArchive {
  private coordinator: PulseArchiveCoordinator;
  private db: PulseArchiveDb;
  private chunkSize: number;
  private log: (stream: string, error: unknown) => void;

  constructor(options: {
    coordinator: PulseArchiveCoordinator;
    db: PulseArchiveDb;
    chunkSize?: number;
    log?: (stream: string, error: unknown) => void;
  }) {
    this.coordinator = options.coordinator;
    this.db = options.db;
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE;
    this.log = options.log ?? ((stream, error) => console.warn("[pulse-archive]", stream, reason(error)));
  }

  async run(snapshot: PulseArchiveSnapshot): Promise<void> {
    for (const stream of snapshot.streams) {
      try {
        if (stream.error) throw new Error(stream.error);
        const built = archiveStatements(this.db, stream, snapshot.now);
        for (let at = 0; at < built.statements.length; at += this.chunkSize) {
          await this.db.batch(built.statements.slice(at, at + this.chunkSize));
        }
        if (built.watermark > stream.watermark || built.replaceToken) {
          await this.coordinator.confirmPulseArchive(stream.stream, built.watermark, built.replaceToken);
        }
      } catch (error) {
        this.log(stream.stream, error);
      }
    }
  }
}

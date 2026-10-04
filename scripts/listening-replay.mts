import {
  absoluteQuantile,
  collectorPlays,
  loadRecordedSession,
  recordedContainer,
  recordedTruth,
  replayAtCadence,
  replayNextAtCadence,
  scoreReplay,
} from "@/lib/testing/listening-replay";

const session = loadRecordedSession();
const truth = recordedTruth(session);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

console.log(`recording: ${session.polls.length} polls every ${seconds(session.pollEveryMs)}, ${truth.filter((play) => play.scored).length} scored songs`);
console.log("poll every | named right (mean / worst phase) | start error median / p90 / max | missed");
for (const cadenceMs of [15_000, 30_000, 60_000, 300_000]) {
  const { coverage, startErrorsMs, missed } = replayAtCadence(session, truth, cadenceMs);
  const mean = coverage.reduce((sum, value) => sum + value, 0) / coverage.length;
  console.log(`${seconds(cadenceMs).padStart(10)} | ${percent(mean)} / ${percent(Math.min(...coverage))} | ${seconds(absoluteQuantile(startErrorsMs, 0.5))} / ${seconds(absoluteQuantile(startErrorsMs, 0.9))} / ${seconds(absoluteQuantile(startErrorsMs, 1))} | ${missed}`);
}
const range = { from: session.startedAt + session.collector[0][0], to: session.startedAt + session.collector.at(-1)![1] };
const production = scoreReplay(truth, collectorPlays(session), range);
console.log(`production collector windows: named right ${percent(production.coverage)}, start error median ${seconds(absoluteQuantile(production.startErrorsMs, 0.5))} / p90 ${seconds(absoluteQuantile(production.startErrorsMs, 0.9))}, missed ${production.plays - production.matched}`);
console.log("next song, playlist in order | poll every | right / wrong / silent");
const container = recordedContainer(session);
for (const cadenceMs of [15_000, 60_000, 300_000]) {
  const { right, wrong, silent } = replayNextAtCadence(session, container, cadenceMs);
  console.log(`${seconds(cadenceMs).padStart(10)} | ${right} / ${wrong} / ${silent}`);
}

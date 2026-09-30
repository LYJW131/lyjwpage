import { PROBE_INTERVAL_MS, settleProbe, type ConsolePower } from "./cadence.js";
import { config } from "./config.js";
import { probeOnce } from "./probe.js";
import { FileStore } from "./store.js";
import { runPlaystation } from "./tick.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const env = config.env(new FileStore(config.dataDir));
  let power: ConsolePower = "off";
  let offStreak = 0;
  for (;;) {
    const started = Date.now();
    const reading = await probeOnce(config.ps5Host, config.probeTimeoutMs);
    const settled = settleProbe(power, reading, offStreak);
    if (settled.power !== power) {
      console.log(JSON.stringify({
        event: "playstation-probe",
        reading,
        power: settled.power,
        offStreak: settled.offStreak,
      }));
    }
    power = settled.power;
    offStreak = settled.offStreak;
    try {
      await runPlaystation(env, power);
    } catch (error) {
      console.error(JSON.stringify({
        event: "playstation-tick-failed",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    await sleep(Math.max(0, PROBE_INTERVAL_MS - (Date.now() - started)));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "playstation-fatal",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});

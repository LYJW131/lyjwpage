import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const setup = fileURLToPath(new URL("./cloud/setup.sh", import.meta.url));

const CURL_STUB = `#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --retry|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
name="$(basename "$url")"
if [ "$name" = "\${STUB_TRUNCATE:-}" ]; then echo 'echo partial' > "$out"; exit 18; fi
cat > "$out" <<PART
echo "$name A=\\\${AAPAY_SIGN_KEY_B64:-} D=\\\${DEVIN_SESSION_TOKEN:-}" >> "\\\$STUB_LOG"
[ "\\\${STUB_RUN_FAIL:-}" = "$name" ] && exit 1
exit 0
PART
`;

function run(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "cloud-setup-"));
  const log = join(dir, "log");
  writeFileSync(log, "");
  for (const [file, body] of [
    ["curl", CURL_STUB],
    ["timeout", '#!/bin/bash\nshift\nexec "$@"\n'],
  ]) {
    writeFileSync(join(dir, file), body);
    chmodSync(join(dir, file), 0o755);
  }
  const result = spawnSync("bash", [setup], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      TMPDIR: dir,
      STUB_LOG: log,
      AAPAY_SIGN_KEY_B64: "key",
      DEVIN_SESSION_TOKEN: "tok",
      ...extra,
    },
  });
  return { status: result.status, stderr: result.stderr, ran: readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

test("四份脚本按顺序执行，每份只看到自己需要的机密", () => {
  const { status, ran } = run({});
  assert.equal(status, 0);
  assert.deepEqual(ran, [
    "signing.sh A=key D=",
    "browser-trust.sh A= D=",
    "devin.sh A= D=tok",
    "claude-user.sh A= D=",
  ]);
});

test("必需脚本下载被截断时不执行任何部分并退出 1", () => {
  const { status, stderr, ran } = run({ STUB_TRUNCATE: "signing.sh" });
  assert.equal(status, 1);
  assert.match(stderr, /failed to fetch signing\.sh/);
  assert.deepEqual(ran, []);
});

test("browser-trust 下载失败时签名已装、其后的脚本不跑", () => {
  const { status, ran } = run({ STUB_TRUNCATE: "browser-trust.sh" });
  assert.equal(status, 1);
  assert.deepEqual(ran, ["signing.sh A=key D="]);
});

test("devin.sh 失败只告警，claude-user.sh 照跑", () => {
  const { status, stderr, ran } = run({ STUB_RUN_FAIL: "devin.sh" });
  assert.equal(status, 0);
  assert.match(stderr, /WARNING: devin\.sh failed/);
  assert.equal(ran.at(-1), "claude-user.sh A= D=");
});

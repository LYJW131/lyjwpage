(function () {
  "use strict";
  // 剧情音的物理建模：力脉冲激励模态、噪声带随速度移动、小房间加话筒底噪，做法取自 earshot forge（docs/references.md「讲解动画音效」）。
  // 一套材质贯穿全片：木桌与木块、毡槌、纸、少量黄铜与钢片；带音高的件（celesta、颤音琴、木琴）都按乐谱给的音高。
  const TAU = Math.PI * 2;
  window.ScoreFx = function (h) {
    const { sr, get, hz, midi, mulberry32, biquad, keyPre, len: LEN } = h;
    const N = (sec) => Math.max(1, Math.round(sec * sr));
    const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(TAU * r());
    const unit = (x) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); if (m > 0) for (let i = 0; i < x.length; i++) x[i] /= m; return x; };
    // 各层按起音后 5 ms 的能量对齐：噪声的峰值说明不了它有多响
    function en(x, from = 0, ms = 5) {
      let i0 = from;
      while (i0 < x.length && Math.abs(x[i0]) < 1e-9) i0++;
      const m = Math.min(x.length, i0 + N(ms / 1000));
      let s = 0;
      for (let i = i0; i < m; i++) s += x[i] * x[i];
      const k = 1 / (Math.sqrt(s / Math.max(1, m - i0)) + 1e-12);
      for (let i = 0; i < x.length; i++) x[i] *= k;
      return x;
    }
    const add = (d, x, g = 1, at = 0) => { const i0 = Math.round(at * sr); for (let i = 0; i < x.length && i0 + i < d.length; i++) if (i0 + i >= 0) d[i0 + i] += g * x[i]; return d; };
    const white = (n, r) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = gauss(r); return d; };
    function pink(n, r) {
      const d = new Float32Array(n);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = gauss(r);
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
      return d;
    }
    function brown(n, r) { const d = new Float32Array(n); let s = 0; for (let i = 0; i < n; i++) { s = 0.995 * s + 0.05 * gauss(r); d[i] = s; } return unit(d); }
    const band = (x, lo, hi) => { biquad(biquad(x, "hp", lo), "hp", lo); return biquad(biquad(x, "lp", hi), "lp", hi); };

    // 阻尼正弦之和：一个物体的模态。glide>0 时音高随衰减下落（膜的张力调制），<0 时上滑（腔体开口）
    function ring(n, modes, r, glideTau = 0.03) {
      const d = new Float32Array(n);
      for (const [f, tau, amp, glide = 0] of modes) {
        if (!amp || f >= sr * 0.46) continue;
        const m = Math.min(n, N(9 * tau) + 2), k = Math.exp(-1 / (tau * sr));
        let ph = r() * TAU, e = amp;
        for (let i = 0; i < m; i++) {
          ph += TAU * f * (1 + glide * Math.exp(-i / sr / glideTau)) / sr;
          d[i] += e * Math.sin(ph); e *= k;
        }
      }
      return d;
    }
    // 密集的模态云（木板、塑料壳）：对数均布，越高衰减越快；布局取 kr，同一件物体每次一样，每一下只靠 r 稍微走音
    function cloud(n, lo, hi, count, tauLo, tauHi, kr, r, tilt = -3) {
      const modes = [];
      for (let j = 0; j < count; j++) {
        const f = Math.exp(Math.log(lo) + kr() * Math.log(hi / lo)), u = Math.log(f / lo) / Math.log(hi / lo);
        modes.push([f * (1 + 0.002 * gauss(r)), Math.exp(Math.log(tauLo) + u * Math.log(tauHi / tauLo)), Math.pow(10, tilt * Math.log2(f / lo) / 20) * (0.3 + 0.7 * kr())]);
      }
      return ring(n, modes, r);
    }
    function hiss(n, lo, hi, tau, r) {
      const m = Math.min(n, N(9 * tau) + 2), w = band(white(m, r), lo, hi), d = new Float32Array(n);
      for (let i = 0; i < m; i++) d[i] = w[i] * Math.exp(-i / sr / tau);
      return d;
    }
    // 接触力脉冲，越长高频越少：毡槌、橡胶章面比塑料键帽软。用高斯而不是半正弦：半正弦的频谱有零点，带音高的件会有几个音几乎打不响
    function drive(x, tc) {
      const k = Math.max(1, Math.round(tc * sr));
      if (k < 2) return x;
      const p = new Float32Array(k);
      let s = 0;
      for (let j = 0; j < k; j++) s += (p[j] = Math.exp(-0.5 * Math.pow((j + 0.5 - k / 2) / (k / 4.5), 2)));
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) { let v = 0; for (let j = 0; j < k && j <= i; j++) v += p[j] * x[i - j]; y[i] = v / s; }
      return y;
    }
    // 慢推力：桌子或键盘整体在脚垫上动，低频包络先涨后衰；话筒只听到压强，准静态的推本身要高通掉
    function thump(n, f, tau, rise, r, hpAt = 0.75 * f, f2 = 0, lvl2 = 0) {
      const d = new Float32Array(n), ph = r() * TAU;
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] = Math.exp(-t / tau) * Math.sin(TAU * f * t + ph) + (f2 ? lvl2 * Math.exp(-t / (tau * 0.75)) * Math.sin(TAU * f2 * t + 0.5) : 0); }
      const k = Math.max(2, N(rise)), y = new Float32Array(n);
      let s = 0;
      const p = new Float32Array(k);
      for (let j = 0; j < k; j++) s += (p[j] = 0.5 - 0.5 * Math.cos(TAU * j / k));
      for (let i = 0; i < n; i++) { let v = 0; for (let j = 0; j < k && j <= i; j++) v += p[j] * d[i - j]; y[i] = v / s; }
      biquad(y, "hp", hpAt); biquad(y, "hp", hpAt);
      return unit(y);
    }
    // TPT 状态变量滤波器，截止频率可逐样本变：气流、扫频
    function svf(x, fOf, q, mode = "bandn") {
      const k = 1 / q, y = new Float32Array(x.length);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < x.length; i++) {
        const g = Math.tan(Math.PI * Math.min(Math.max(fOf(i / sr), 20), sr * 0.45) / sr), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        const v3 = x[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
        s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
        y[i] = mode === "low" ? v2 : mode === "high" ? x[i] - k * v1 - v2 : k * v1;
      }
      return y;
    }
    // 小房间：几次早期反射加一段高频先衰的 Schroeder 尾巴，开销按样本线性，浏览器现合成也扛得住
    function room(x, r, { wet = 0.12, rt60 = 0.2, size = 0.3, damp = 0.5 } = {}) {
      const n = x.length, y = Float32Array.from(x), tail = new Float32Array(n);
      for (let j = 0; j < 6; j++) {
        const dl = N(0.002 + r() * (0.004 + 0.02 * size)), g = (0.15 + 0.3 * r()) * (r() < 0.5 ? -1 : 1) * wet;
        for (let i = dl; i < n; i++) y[i] += g * x[i - dl];
      }
      const sc = 0.4 + 0.8 * size;
      for (const ms of [29.7, 37.1, 41.1, 43.7]) {
        const dl = N(ms * sc / 1000), g = Math.pow(10, -3 * (dl / sr) / rt60), buf = new Float32Array(dl);
        let lp = 0, p = 0;
        for (let i = 0; i < n; i++) { const o = buf[p]; lp = o * (1 - damp) + lp * damp; buf[p] = x[i] + g * lp; p = (p + 1) % dl; tail[i] += o; }
      }
      for (const [ms, g] of [[5, 0.7], [1.7, 0.7]]) {
        const dl = N(ms / 1000), buf = new Float32Array(dl);
        let p = 0;
        for (let i = 0; i < n; i++) { const b = buf[p], v = tail[i] + g * b; buf[p] = v; tail[i] = b - g * v; p = (p + 1) % dl; }
      }
      let ex = 0, et = 0;
      for (let i = 0; i < n; i++) { ex += x[i] * x[i]; et += tail[i] * tail[i]; }
      const k = wet * Math.sqrt(ex / (et + 1e-12)) * 0.5;
      for (let i = 0; i < n; i++) y[i] += k * tail[i];
      return y;
    }
    // 话筒与剪辑：低切、底噪（真录音从不是数字静音），首尾淡入淡出
    function mic(x, r, floorDb = -62, fadeOut = 0.02) {
      biquad(x, "hp", 35);
      let pk = 0;
      for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
      const fl = pink(x.length, r), g = pk * Math.pow(10, floorDb / 20);
      const a = N(0.0005), b = Math.min(x.length, N(fadeOut));
      for (let i = 0; i < x.length; i++) {
        let v = x[i] + g * fl[i];
        if (i < a) v *= i / a;
        if (i >= x.length - b) v *= 0.5 + 0.5 * Math.cos(Math.PI * (i - (x.length - b)) / b);
        x[i] = v;
      }
      if (x.some((v) => !Number.isFinite(v))) throw new Error("Invalid fx sample");
      return unit(x);
    }

    // 话放的软削波：只压最尖的那几毫秒，峰值决定整片母带的增益，尖峰低一点整片就能响一点
    const soft = (x, k = 1.6) => { const c = Math.tanh(k); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(k * x[i]) / c; return x; };

    // 一下塑料接触：裂响 + 高频壳体模态 + 键帽模态（被手指按住，先自由振一下再被压住）+ 机身
    function contact(n, kr, r, { cap = 1489, pitch = 1, bright = 1, body = 205 } = {}) {
      const tc = 7.6e-5 * Math.exp(0.15 * gauss(r));
      const hf = unit(drive(cloud(n, 7300, 18000, 40, 0.00064, 0.00024, kr, r, -1.25), tc));
      const ck = new Float32Array(n), m = N(0.0015);
      for (let i = 0; i < m && i < n; i++) ck[i] = gauss(r) * Math.exp(-i / sr / 0.00016);
      biquad(ck, "hp", 1200);
      const crack = unit(drive(ck, tc * 0.5));
      const cf = cap * pitch, capB = hiss(n, cf * 0.75, cf * 2.4, 0.0032, r);
      for (let i = 0; i < n; i++) capB[i] *= 0.75 + 0.25 * Math.exp(-i / sr / 0.001);
      const capD = drive(capB, Math.max(tc, 0.00012));
      const bf = body * pitch, mid = ring(n, [[bf, 0.0092, 1], [bf * (1.35 + 0.25 * kr()), 0.0064, 0.5], [bf * (1.9 + 0.5 * kr()), 0.0046, 0.3]], r);
      const x = new Float32Array(n), top = Float32Array.from(hf);
      for (let i = 0; i < n; i++) top[i] += 0.4 * crack[i];
      add(x, en(top), 0.2 * bright); add(x, en(capD)); add(x, en(mid), 0.09);
      return unit(x);
    }

    // 机械键盘的一下：按到底、整块键盘在桌上「咚」、弹簧一声细响、70–125 ms 后回弹（forge 的 keypress 配方）
    function keyArr(v, { cap = 1489, thockLvl = 0.23, upLvl = 0.1, pre = keyPre, clip = 0.36 } = {}) {
      const n = N(pre + clip), d = new Float32Array(n), r = mulberry32(8100 + 13 * v), kr = mulberry32(8200 + 31 * v);
      const capF = cap * (0.94 + 0.12 * kr()), up = 0.1 + 0.022 * kr(), m = n - N(pre);
      if (pre > 0) {
        const len = N(0.0128), w = band(white(len, r), 700, 9000);
        for (let i = 0; i < len; i++) w[i] *= Math.pow(i / len, 2);
        add(d, unit(w), 0.02, pre - len / sr);
      }
      add(d, contact(m, kr, r, { cap: capF }), 1, pre);
      add(d, thump(m, 87 * (0.97 + 0.06 * kr()), 0.055, 0.0083, r, 52, 70, 0.58), thockLvl, pre);
      add(d, unit(ring(N(0.06), [[9083, 0.0058, 1], [9201, 0.0046, 0.5], [14700, 0.0023, 0.1]], r)), 0.12, pre);
      const tick = unit(drive(cloud(N(0.01), 4000, 12000, 12, 0.0006, 0.0003, kr, r), 0.00005));
      add(d, tick, 0.05, pre + up - 0.011); add(d, tick, 0.035, pre + up - 0.004);
      add(d, contact(N(0.12), mulberry32(8300 + 31 * v), r, { cap: capF, pitch: 1.044 }), upLvl, pre + up);
      return mic(room(d, r, { wet: 0.26, rt60: 0.11, size: 0.21, damp: 0.95 }), r, -58, 0.03);
    }
    const key = (v) => get("fx:key:" + v, () => keyArr(v));
    // 节奏里的打字声：轻一些的薄键（笔记本那种），不要预行程，接触点就在拍上
    const type = (v) => get("fx:type:" + v, () => keyArr(40 + v, { cap: 2100, thockLvl: 0.07, upLvl: 0.06, pre: 0, clip: 0.16 }));

    // 橡胶章面盖到一叠纸上、纸下是木桌：软接触（几毫秒），桌板模态云，整张桌子的低频，纸面被挤出的气
    const stamp = (size) => get("fx:stamp:" + size, () => {
      const big = size === "big", n = N(big ? 0.95 : 0.62), r = mulberry32(big ? 6100 : 6200), kr = mulberry32(6300);
      const tc = big ? 0.0034 : 0.0024, d = new Float32Array(n);
      add(d, en(drive(cloud(n, 140, 2400, 44, big ? 0.1 : 0.07, 0.008, kr, r, -4), tc)));
      add(d, en(thump(n, big ? 63 : 74, big ? 0.08 : 0.055, 0.006, r, 45)), big ? 0.5 : 0.32);
      add(d, en(hiss(n, 700, 4200, big ? 0.009 : 0.007, r)), 0.75);
      add(d, en(drive(ring(n, [[620, 0.02, 1], [1430, 0.012, 0.5], [2210, 0.006, 0.3]], r), 0.0004)), 0.35);
      if (big) for (const at of [0.07 + 0.03 * kr(), 0.13 + 0.04 * kr(), 0.2 + 0.04 * kr()]) add(d, unit(drive(cloud(N(0.03), 900, 3200, 10, 0.004, 0.0015, kr, r), 0.0003)), 0.06 + 0.04 * r(), at);
      return soft(mic(room(d, r, { wet: 0.16, rt60: 0.26, size: 0.4, damp: 0.6 }), r, -64), 2.2);
    });

    // celesta：毡槌敲钢片，钢片自由-自由梁的分音 1 : 2.756 : 5.404 : 8.933，木箱共鸣托住基音
    function celestaArr(m, len = 1.4, seed = 0) {
      const f = hz(m), n = N(len), r = mulberry32(7000 + m + seed), t1 = Math.min(0.9, 0.55 * Math.pow(880 / f, 0.4));
      const d = drive(ring(n, [[f, t1, 1], [f * 2.756, t1 / 4, 0.22], [f * 5.404, t1 / 10, 0.07], [f * 8.933, t1 / 20, 0.025]], r), 0.0005);
      add(d, unit(hiss(n, 300, 2500, 0.003, r)), 0.06);
      add(d, unit(ring(n, [[310, 0.015, 1]], r)), 0.04);
      return d;
    }
    const ding = (m) => get("fx:ding:" + m, () => { const r = mulberry32(7100 + m); return mic(room(celestaArr(m), r, { wet: 0.14, rt60: 0.3, size: 0.3 }), r, -66, 0.08); });

    // 小开关：一个阻尼很重的塑料壳模态加一点机身，触点再弹一下（forge 的 click 配方）
    function switchArr(n, r, kr) {
      const d = ring(n, [[4500 * (0.95 + 0.1 * kr()), 0.0006, 2.5], [1500, 0.002, 0.3]], r);
      add(d, cloud(n, 4200, 12000, 10, 0.0018, 0.0008, kr, r), 0.5);
      const snap = Float32Array.from(d);
      add(d, snap, 0.5, 0.0008); add(d, snap, 0.45, 0.0015);
      add(d, thump(n, 140, 0.004, 0.003, r, 80), 0.15);
      return unit(drive(d, 0.0002));
    }
    // 颤音琴铝片：调过的分音 1 : 4 : 10，毛线槌
    function vibeArr(n, f, r, t1 = 0.6, glide = null) {
      const d = new Float32Array(n);
      for (const [k, tau, amp] of [[1, t1, 1], [4, t1 / 4, 0.3], [10, t1 / 14, 0.08]]) {
        const fk = f * k;
        if (fk >= sr * 0.46) continue;
        let ph = r() * TAU;
        for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * fk * (glide ? glide(t) : 1) / sr; d[i] += amp * Math.exp(-t / tau) * Math.sin(ph); }
      }
      return unit(drive(d, 0.0006));
    }
    const lamp = (m, late) => get("fx:lamp:" + m + ":" + (late ? 1 : 0), () => {
      const n = N(1.8), r = mulberry32(9100 + m + (late ? 50 : 0)), kr = mulberry32(9150), d = vibeArr(n, hz(m), r, late ? 0.55 : 0.62);
      if (!late) add(d, switchArr(N(0.05), r, kr), 0.35);
      if (late) biquad(biquad(d, "lp", 2500), "lp", 2500);
      return mic(room(d, r, { wet: late ? 0.3 : 0.15, rt60: late ? 0.6 : 0.3, size: late ? 0.7 : 0.3 }), r, -66, 0.1);
    });
    const off = (m) => get("fx:off:" + m, () => {
      const n = N(1), r = mulberry32(9300 + m), kr = mulberry32(9150);
      const d = vibeArr(n, hz(m), r, 0.28, (t) => Math.pow(0.5, Math.min(1, t / 0.45)));
      biquad(d, "lp", 3000);
      add(d, switchArr(N(0.05), r, kr), 0.5);
      return mic(room(d, r, { wet: 0.2, rt60: 0.4, size: 0.4 }), r, -66, 0.06);
    });
    // 木琴（玫瑰木琴片 1 : 3.99 : 9.2，下面一根共鸣管晚一点起、托长基音），软线槌
    const ping = (m, late) => get("fx:ping:" + m + ":" + (late ? 1 : 0), () => {
      const f = hz(m), n = N(1.2), r = mulberry32(9500 + m + (late ? 7 : 0)), t1 = 0.6 * Math.pow(220 / f, 0.3);
      const d = drive(ring(n, [[f, t1, 1], [f * 3.99, 0.09, 0.25], [f * 9.2, 0.03, 0.06]], r), 0.0025);
      const tube = ring(n, [[f, t1 * 1.4, 0.35]], r);
      for (let i = 0; i < n; i++) tube[i] *= 1 - Math.exp(-i / sr / 0.02);
      add(d, tube); add(d, unit(hiss(n, 150, 1200, 0.006, r)), 0.06);
      if (late) { biquad(d, "lp", 900); biquad(d, "lp", 900); }
      return mic(room(d, r, { wet: late ? 0.35 : 0.12, rt60: late ? 0.8 : 0.3, size: 0.5 }), r, -66, 0.08);
    });
    // Clawd 跳一下：小木块被指尖一点那么轻，音高跟着乐谱；三种取法轮换，免得一模一样连着响
    const hop = (m, take = 0) => get("fx:hop:" + m + ":" + take, () => {
      const f = hz(m), n = N(0.3), r = mulberry32(9700 + 3 * m + take), kr = mulberry32(9750 + take);
      const d = drive(ring(n, [[f, 0.03, 1], [f * 3.92, 0.012, 0.35], [f * 9.1, 0.005, 0.1]], r), 0.0006);
      add(d, unit(drive(cloud(n, 800, 5000, 16, 0.004, 0.0015, kr, r), 0.0002)), 0.35);
      add(d, unit(hiss(n, 1000, 6000, 0.0018, r)), 0.2);
      add(d, unit(ring(n, [[180 + 30 * kr(), 0.008, 1]], r)), 0.2);
      return mic(room(d, r, { wet: 0.08, rt60: 0.15, size: 0.15 }), r, -64, 0.04);
    });

    // 一阵风：物体扫过话筒时的速度包络 U(t)，涡脱落按长度方向几条带、强度约 U³；细碎的湍流嘶声在上面，过后留一小段尾流（forge 的 whoosh 配方）
    function airPass(n, r, { tc, rise, fall, fPeak, hissDb = -19, wakeDb = -16, proxW = 0.06, push = 0.2 }) {
      const U = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = i / sr - tc, s = x < 0 ? rise : fall; U[i] = Math.exp(-Math.pow(Math.abs(x / s), 1.5) / 2) / Math.sqrt(1 + Math.pow(x / proxW, 2)); }
      const d = new Float32Array(n);
      for (const sk of [0.45, 0.65, 0.85, 1]) {
        const w = svf(pink(n, r), (t) => fPeak * sk * Math.pow(U[Math.min(n - 1, Math.round(t * sr))] + 0.05, 0.11), 2.2);
        const s2 = svf(w, (t) => fPeak * sk * 1.6, 0.7, "low");
        for (let i = 0; i < n; i++) d[i] += Math.pow(sk * U[i], 3) * s2[i];
      }
      const hs = svf(band(white(n, r), 1700, 16000), (t) => 2500 + 9000 * U[Math.min(n - 1, Math.round(t * sr))], 0.7, "low");
      const hg = Math.pow(10, hissDb / 20) * 4;
      for (let i = 0; i < n; i++) d[i] += hg * Math.pow(U[i], 2.6) * hs[i];
      const wk = svf(pink(n, r), (t) => fPeak * Math.pow(1 + Math.max(0, t - tc) / 0.05, -0.6), 4.4), wg = Math.pow(10, wakeDb / 20) * 3;
      for (let i = 0; i < n; i++) { const x = i / sr - tc; if (x > 0) d[i] += wg * Math.exp(-x / 0.06) * wk[i]; }
      if (push) {
        const p = band(white(n, r), 30, 130);
        for (let i = 0; i < n; i++) { const x = (i / sr - tc) / 0.03; d[i] += push * Math.exp(-x * x) * p[i]; }
      }
      return d;
    }
    const whip = () => get("fx:whip", () => {
      const L = LEN.whip, r = mulberry32(3310), d = airPass(N(L), r, { tc: L / 2, rise: 0.1, fall: 0.12, fPeak: 520, proxW: 0.08, push: 0.12 });
      return mic(room(d, r, { wet: 0.1, rt60: 0.2, size: 0.3 }), r, -70, 0.05);
    });

    // 气动管：胶囊被吸进管口「噗」一声（亥姆霍兹腔的音高往上滑），带着一股风从管里呼地经过、擦着管壁沙沙地碰，最后落进木托盘
    function tubeArr({ fc, L, dec, thunk, seed }) {
      const n = N(L), r = mulberry32(seed), kr = mulberry32(seed + 1), d = new Float32Array(n);
      const f0 = fc * 0.12, q = 7;
      const thoop = ring(n, [[f0, q / (Math.PI * f0), 1, -0.4]], r, 0.03);
      for (let i = 0; i < n; i++) thoop[i] *= 1 - Math.exp(-i / sr / 0.006);
      add(d, unit(thoop), 0.25);
      const tc = 0.16, air = airPass(n, r, { tc, rise: 0.08, fall: dec * 0.6, fPeak: fc * 0.3, proxW: 0.12, push: 0.05, wakeDb: -12 });
      add(d, unit(air), 0.9);
      const env = (t) => Math.exp(-Math.pow(Math.abs(t - tc) / (t < tc ? 0.08 : dec * 0.6), 1.5) / 2);
      const tap = unit(drive(cloud(N(0.02), 1200, 4000, 10, 0.0015, 0.0006, kr, r), 0.0001));
      for (let t = 0.04; t < thunk - 0.02; t += -Math.log(Math.max(1e-6, r())) / 30) add(d, tap, 0.07 * env(t) * (0.5 + r()), t);
      const land = drive(cloud(N(0.3), 250, 2500, 30, 0.025, 0.004, kr, r, -3), 0.0012);
      add(land, thump(N(0.3), 130, 0.02, 0.004, r, 80), 0.3);
      unit(land);
      add(d, land, 0.22, thunk); add(d, land, 0.06, thunk + 0.06 + 0.02 * kr());
      return mic(room(d, r, { wet: 0.12, rt60: 0.25, size: 0.35 }), r, -66, 0.04);
    }
    const TUBE_F = [2300, 1700, 1250, 2900];
    const whoosh = (k) => get("fx:wh:" + k, () => tubeArr({ fc: TUBE_F[k], L: LEN.tube, dec: 0.26, thunk: 0.72, seed: 1110 + 7 * k }));
    const fork = (j) => get("fx:fk:" + j, () => tubeArr({ fc: j ? 1500 : 950, L: LEN.fork, dec: 0.4, thunk: 1.0, seed: 1310 + 7 * j }));

    // 下坠两拍：风声的频带一路往下沉，低频的空气隆隆往上涨，不用正弦滑音
    const down = () => get("fx:down", () => {
      const L = LEN.down, n = N(L + 0.01), r = mulberry32(1210), air = svf(pink(n, r), (t) => 5200 * Math.pow(220 / 5200, Math.min(1, t / L)), 1.6), rum = svf(brown(n, r), () => 160, 0.7, "low");
      const fl = svf(white(n, r), () => 6, 0.7, "low");
      unit(fl);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr, x = Math.min(1, t / L);
        let y = (air[i] * Math.pow(x, 2.2) + 0.4 * rum[i] * Math.pow(x, 3)) * (1 + 0.15 * fl[i]);
        if (t > L - 0.012) y *= Math.max(0, (L - t) / 0.012);
        d[i] = y;
      }
      return mic(d, r, -70, 0.012);
    });
    const swell = () => get("fx:swell", () => {
      const L = LEN.swell, n = N(L), r = mulberry32(1410), air = svf(pink(n, r), (t) => 500 * Math.pow(8, Math.min(1, t / L)), 1.2), top = band(white(n, r), 4000, 12000), d = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i / sr, x = t / L; d[i] = (air[i] * x * x + 0.25 * top[i] * x * x * x) * (t > L - 0.01 ? (L - t) / 0.01 : 1); }
      return mic(d, r, -72, 0.01);
    });

    // 大鼓膜：毡槌重击，基音先高后落（张力调制），膜的 Bessel 分音更快衰掉；一层 D1 的次低频，空间里滚一会儿
    const boom = () => get("fx:boom", () => {
      const n = N(2.8), r = mulberry32(1500), kr = mulberry32(1501), f = hz(midi("D2"));
      const d = drive(ring(n, [[f, 0.5, 1, 0.25], [f * 1.594, 0.25, 0.45, 0.2], [f * 2.136, 0.18, 0.3, 0.2], [f * 2.296, 0.15, 0.25, 0.15], [f * 2.653, 0.1, 0.15, 0.15]], r, 0.06), 0.004);
      const sub = ring(n, [[f / 2, 0.9, 1]], r);
      for (let i = 0; i < n; i++) sub[i] *= Math.min(1, i / sr / 0.006);
      add(d, unit(sub), 0.8);
      add(d, en(hiss(n, 200, 2500, 0.005, r)), 0.12);
      add(d, unit(cloud(n, 120, 600, 30, 0.2, 0.04, kr, r)), 0.15);
      const roll = svf(brown(n, r), () => 140, 0.7, "low");
      for (let i = 0; i < n; i++) { const t = i / sr; d[i] += 0.12 * roll[i] * Math.min(1, t / 0.15) * (t < 0.8 ? 1 : Math.exp(-(t - 0.8) / 0.5)); }
      for (let i = 0; i < n; i++) d[i] = Math.tanh(1.2 * d[i]);
      return mic(room(d, r, { wet: 0.22, rt60: 1.2, size: 0.8, damp: 0.4 }), r, -72, 0.3);
    });

    // 纸条滑进槽里：纸面摩擦是一串黏-滑的小冲击，带纸的共鸣；最后边缘磕在木挡板上
    const slip = (take = 0) => get("fx:slip:" + take, () => {
      const n = N(0.5), r = mulberry32(1510 + take), kr = mulberry32(1520), gr = new Float32Array(n);
      for (let i = 0; i < n; i++) gr[i] = r() < 1800 / sr ? gauss(r) * 3 : 0.35 * gauss(r);
      const fr = svf(gr, (t) => 1100 + 1300 * Math.min(1, t / 0.32), 0.9), fl = svf(white(n, r), () => 9, 0.7, "low");
      unit(fl);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i / sr, e = t < 0.06 ? Math.pow(Math.sin(Math.PI / 2 * t / 0.06), 2) : t < 0.26 ? 1 : Math.max(0, 1 - (t - 0.26) / 0.06); d[i] = fr[i] * e * (0.8 + 0.25 * fl[i]); }
      unit(d);
      const tap = drive(cloud(N(0.1), 700, 3500, 16, 0.006, 0.002, kr, r), 0.0003);
      add(tap, ring(N(0.1), [[300, 0.02, 1]], r), 0.3);
      add(d, unit(tap), 0.6, 0.33);
      return soft(mic(room(d, r, { wet: 0.1, rt60: 0.2, size: 0.25 }), r, -64, 0.03), 2.2);
    });
    const clear = () => get("fx:clr", () => {
      const n = N(0.95), r = mulberry32(3610), gr = new Float32Array(n);
      for (let i = 0; i < n; i++) gr[i] = r() < 1800 / sr ? gauss(r) * 2 : 0.4 * gauss(r);
      const fr = svf(gr, (t) => 1400 + 1800 * Math.min(1, t / 0.85), 0.8), d = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i / sr, u = (t % 0.3) / 0.3; d[i] = fr[i] * Math.pow(Math.sin(Math.PI * u), 2) * (t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.05)); }
      return mic(room(d, r, { wet: 0.1, rt60: 0.2 }), r, -66, 0.05);
    });

    // 广播：颤音琴四个音快速滚奏，开着马达的颤音；底下一口软风托起来
    const broadcast = () => get("fx:bc", () => {
      const n = N(2.2), r = mulberry32(1610), d = new Float32Array(n);
      [["A5", 1], ["D6", 0.8], ["F6", 0.7], ["E6", 0.6]].forEach(([nm, g], i) => add(d, vibeArr(n - N(0.025 * i), hz(midi(nm)), r, 0.9), g, 0.025 * i));
      unit(d);
      const w = svf(pink(n, r), (t) => 1800 * Math.pow(3, Math.min(1, t / 1.2)), 1.5);
      unit(w);
      for (let i = 0; i < n; i++) {
        const t = i / sr, trem = 0.7 + 0.3 * Math.cos(TAU * 6.5 * t), depth = Math.min(1, t / 0.3), sw = t < 0.3 ? t / 0.3 : Math.exp(-(t - 0.3) / 0.6);
        d[i] = d[i] * (1 - 0.3 * depth * (1 - trem)) + 0.12 * w[i] * sw;
      }
      return mic(room(d, r, { wet: 0.2, rt60: 0.5, size: 0.5 }), r, -68, 0.2);
    });
    // 翻卡：指尖弹开卡边一声脆、卡片带一小口风、落下拍在桌面；同时 celesta 两个音
    const flipHit = () => get("fx:fh", () => {
      const n = N(1.4), r = mulberry32(1710), kr = mulberry32(1711), d = new Float32Array(n);
      add(d, celestaArr(midi("G6"), 1.4, 1)); add(d, celestaArr(midi("D7"), 1.4, 2), 0.7);
      unit(d);
      const flick = hiss(N(0.05), 1500, 6000, 0.0025, r);
      add(flick, cloud(N(0.05), 2000, 5000, 8, 0.001, 0.0005, kr, r), 0.5);
      add(d, unit(flick), 0.35);
      const fl = svf(pink(N(0.05), r), (t) => 1200 + 26000 * t, 1);
      for (let i = 0; i < fl.length; i++) fl[i] *= Math.sin(Math.PI * i / fl.length);
      add(d, unit(fl), 0.12, 0.004);
      const slap = hiss(N(0.06), 600, 3500, 0.006, r);
      add(slap, ring(N(0.06), [[220, 0.01, 1]], r), 0.4);
      add(d, unit(slap), 0.28, 0.045);
      return mic(room(d, r, { wet: 0.15, rt60: 0.35, size: 0.35 }), r, -66, 0.1);
    });
    // 电键：黄铜杠杆按下、抬起各一声触点，耳机里的音带一点奇次谐波
    const morse = (m, len) => get("fx:ms:" + m + ":" + len, () => {
      const f = hz(m), n = N(len + 0.06), r = mulberry32(3010 + m), kr = mulberry32(3011), d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / sr, g = Math.min(1, t / 0.004) * (t < len ? 1 : Math.max(0, 1 - (t - len) / 0.012));
        d[i] = g * (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 3 * f * t) + 0.06 * Math.sin(TAU * 5 * f * t));
      }
      biquad(d, "lp", 2600);
      const clk = drive(cloud(N(0.03), 2000, 6000, 10, 0.0008, 0.0004, kr, r), 0.0001);
      add(clk, ring(N(0.03), [[900, 0.003, 1]], r), 0.3);
      unit(clk);
      add(d, clk, 0.3); add(d, clk, 0.18, len);
      return mic(d, r, -66, 0.01);
    });
    // 闸门弹开：插销一声脆，钢闩被弹簧顶开撞到挡块（钢梁分音），门扇带着重量一顿，再扫过一口风
    const gate = () => get("fx:gate", () => {
      const n = N(0.7), r = mulberry32(3110), kr = mulberry32(3111), d = new Float32Array(n);
      const latch = drive(cloud(N(0.05), 2500, 7000, 12, 0.0012, 0.0005, kr, r), 0.0001);
      add(latch, ring(N(0.05), [[1100, 0.004, 1]], r), 0.4);
      add(d, unit(latch), 0.5);
      add(d, unit(drive(ring(n, [[420, 0.07, 0.8], [420 * 2.756, 0.04, 0.45], [420 * 5.404, 0.02, 0.25], [420 * 8.933, 0.012, 0.12]], r), 0.00025)), 0.45, 0.01);
      add(d, unit(drive(cloud(n, 300, 6000, 40, 0.03, 0.003, kr, r, -2), 0.0002)), 0.6, 0.01);
      add(d, thump(n, 85, 0.06, 0.005, r, 55), 0.8, 0.01);
      const air = svf(pink(n, r), (t) => 2600 * Math.pow(700 / 2600, Math.min(1, t / 0.4)), 1.4);
      unit(air);
      for (let i = 0; i < n; i++) { const t = i / sr; if (t > 0.04) d[i] += 0.25 * air[i] * Math.sin(Math.PI * Math.min(1, (t - 0.04) / 0.5)); }
      return mic(room(d, r, { wet: 0.2, rt60: 0.4, size: 0.5 }), r, -66, 0.05);
    });

    return { key, type, stamp, ding, lamp, off, ping, hop, whip, whoosh, fork, down, swell, boom, slip, clear, broadcast, flipHit, morse, gate };
  };
})();

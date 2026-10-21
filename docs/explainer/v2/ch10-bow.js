// 终章谢幕：十条竖幕按第 00–09 章的底色落下，每条站一只那种画风的 Clawd，挨个鞠躬、一起鞠躬、庆祝、跳下台；
// 幕布升起时底下已经是第 00 章的第一帧（termFrame(termState(0))），AT.still 之后只剩它，首尾接得上、可以循环。
(() => {
  const { E, prog, clamp, lerp, hash } = K;
  const F10 = window.FIN10, { PAL, CLAWD, chip, rgba } = F10;
  I18N.add({
    "ch10.end1": ["谢谢观看", "Thanks for watching"],
    "ch10.end2": ["讲解 Claude Opus 5.5 · lyjw.me", "Narrated by Claude Opus 5.5 · lyjw.me"],
    ...Object.fromEntries([["晒图", "Blueprint"], ["微缩", "Miniature"], ["海报", "Poster"], ["卡通", "Cartoon"], ["报纸", "Newsprint"],
      ["剪纸", "Cutout"], ["水墨", "Ink wash"], ["像素", "8-bit"], ["彩铅", "Pencil"], ["地铁", "Metro"]].map((s, i) => [`ch10.short.${i}`, s])),
  });
  const tr = (k) => I18N.tr(k);
  // 拍位（小节）：music/ch10.js 抄的是同一张表。
  const AT = {
    drop: 17.0, dropStep: 0.03, bands: [17.2, 17.5], pop: 17.5, popStep: 0.04, thanks: 18.0, credit: 18.25,
    bow1: 18.25, bowStep: 0.0625, bow2: 19.25, cheer: 19.75, leave: 20.25, leaveStep: 0.012, leaveLen: 0.2, lift: 20.5, liftStep: 0.05, still: 21.5,
  };
  const W = 192;
  const CURT = [rgba(PAL.bpBlue), PAL.miniSky0, rgba(PAL.cPaper), rgba(PAL.tCard), rgba(PAL.nPaper), rgba(PAL.sMustard), rgba(PAL.wPaper), PAL.pxBlue, PAL.pcWall, PAL.mBg];
  const VAL = [rgba(PAL.bpWhite), PAL.miniCoral, rgba(PAL.cRed), rgba(PAL.tCream), rgba(PAL.nInk), rgba(PAL.sRed), rgba(PAL.wVerm), PAL.pxSky, PAL.pcSticky, PAL.mRed];
  const DARK = [true, false, false, true, false, false, false, true, false, false];
  const SANS = (px, w = 700) => (I18N.lang === "en" ? `${w} ${px}px "Inter ch09", sans-serif` : `${w} ${px}px "Noto Sans SC ch09", "Inter ch09", sans-serif`);
  // 鞠躬：0.08 小节弯下去，停一下，再直起来。
  const bump = (b, t0, len) => { const k = (b - t0) / len; return k <= 0 || k >= 1 ? 0 : k < 0.3 ? E.out(k / 0.3) : k < 0.6 ? 1 : 1 - E.io((k - 0.6) / 0.4); };

  function curtains(x, b, BAR) {
    for (let i = 0; i < 10; i++) {
      const kd = prog(b, AT.drop + i * AT.dropStep, AT.drop + 0.34 + i * AT.dropStep, E.out), t1 = AT.lift + i * AT.liftStep;
      // 幕后右下角是第 00 章的标题栏（压在第 06–09 条幕下）：这四条在下墨色带走完那一刻一起一下子提起 140（一帧之内，
      // 不做缓动，否则 24 fps 里总有一帧下沿压在字上），标题栏整块露出来，再各自加速升走；挨个按 E.in 慢起的话，下沿会在标题栏的字上停好几帧、露一半。
      const J = AT.lift + 0.3, jerk = i >= 6;
      const kl = prog(b, t1, t1 + 0.45);
      const up = jerk ? (b >= J ? 140 : 0) + 1000 * E.in(prog(b, Math.max(t1, J), t1 + 0.45)) : 1140 * E.in(kl);
      const y = lerp(-1140, 0, kd) - up, x0 = i * W, cx = x0 + W / 2;
      if (kd <= 0 || kl >= 1) continue;
      x.fillStyle = CURT[i]; x.fillRect(x0, y, W, 1100);
      const g = x.createLinearGradient(x0, 0, x0 + W, 0);
      g.addColorStop(0, "rgba(0,0,0,0.16)"); g.addColorStop(0.5, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.16)");
      x.fillStyle = g; x.fillRect(x0, y, W, 1100);
      x.fillStyle = VAL[i]; x.fillRect(x0, y + 170, W, 22);
      const sp = prog(b, AT.pop + i * AT.popStep, AT.pop + 0.1 + i * AT.popStep) * (1 - prog(b, AT.leave + 0.2, AT.leave + 0.4));
      if (sp > 0) {
        const lg = x.createLinearGradient(0, y + 200, 0, y + 880);
        lg.addColorStop(0, `rgba(255,248,226,${0.05 * sp})`); lg.addColorStop(1, `rgba(255,248,226,${0.4 * sp})`);
        x.fillStyle = lg; x.beginPath(); x.moveTo(cx - 26, y + 192); x.lineTo(cx + 26, y + 192); x.lineTo(cx + 92, y + 880); x.lineTo(cx - 92, y + 880); x.closePath(); x.fill();
        x.fillStyle = `rgba(255,248,226,${0.35 * sp})`; x.beginPath(); x.ellipse(cx, y + 866, 86, 14, 0, 0, Math.PI * 2); x.fill();
      }
      const pa = prog(b, AT.pop + i * AT.popStep, AT.pop + 0.12 + i * AT.popStep);
      const ink = DARK[i] ? "#FFFFFF" : "#121212";
      if (pa > 0) {
        chip(x, i, String(i).padStart(2, "0"), cx, y + 320, 88, { alpha: pa, rot: (hash(i + 40) - 0.5) * 0.12, s: lerp(0.6, 1, E.outBack(pa)) });
        K.text(x, tr(`ch10.short.${i}`), cx, y + 452, { font: SANS(30), color: ink, align: "center", alpha: pa });
      }
      clawdOn(x, i, cx, y, b, BAR);
    }
  }
  function clawdOn(x, i, cx, y, b, BAR) {
    const t0 = AT.pop + i * AT.popStep, kp = prog(b, t0, t0 + 0.22);
    if (kp <= 0) return;
    let sink = 170 * (1 - E.outBack(kp)), pose = kp < 1 ? "arms-up" : "default", crouch = 0, sy = 1, lift = 0;
    const bw = Math.max(bump(b, AT.bow1 + i * AT.bowStep, 0.3), bump(b, AT.bow2, 0.42));
    if (bw > 0) { sy = 1 - 0.3 * bw; crouch = bw > 0.5 ? 1 : 0; }
    const fr = K.clawdSeq("celebrate", b, AT.cheer + i * 0.02, BAR);
    if (fr) { pose = fr.pose; crouch = fr.offset || 0; lift = K.hop(b, AT.cheer + i * 0.02, AT.cheer + 0.2 + i * 0.02, 46); }
    // 跳下台：落到下面那条墨色带后面就不再画，赶在 AT.lift 带子滑走、幕后露出第 00 章标题栏之前全部落完。
    const kl = prog(b, AT.leave + i * AT.leaveStep, AT.leave + AT.leaveLen + i * AT.leaveStep);
    if (kl >= 1) return;
    if (kl > 0) { pose = "arms-up"; lift = 180 * kl - 900 * kl * kl; }
    const bottom = y + 862 + sink - lift;
    // 00 晒图那只头顶标一条尺寸线（Clawd 是 18 × 12 格）；07 红白机那只一起鞠躬时冒一个 1UP。
    if (i === 0 && kp >= 1 && kl <= 0) {
      const top = bottom - 12 * 9 * sy - 24;
      x.strokeStyle = rgba(PAL.bpWhite); x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 81, top); x.lineTo(cx + 81, top); x.moveTo(cx - 81, top - 10); x.lineTo(cx - 81, top + 10); x.moveTo(cx + 81, top - 10); x.lineTo(cx + 81, top + 10); x.stroke();
      K.text(x, "18 × 12", cx, top - 12, { font: `500 28px "Barlow Semi Condensed ch00", sans-serif`, color: rgba(PAL.bpWhite), align: "center" });
    }
    const up = prog(b, AT.bow2, AT.bow2 + 0.5);
    if (i === 7 && up > 0 && up < 1) K.text(x, "1UP", cx, bottom - 120 - 70 * up, { font: K.FONT.pixel(40), color: PAL.pxWhite, align: "center", alpha: 1 - E.in(up) });
    // 09 的线路标是一枚直径 21.2 格的圆，按 9 画会顶到幕宽，缩到和别的 Clawd 一样宽。
    CLAWD[i](x, cx, bottom, i === 9 ? 7.6 : 9, { pose, crouch, sy });
  }
  function bands(x, b) {
    const ki = prog(b, AT.bands[0], AT.bands[1], E.out), ko = prog(b, AT.lift, AT.lift + 0.3, E.in);
    if (ki <= 0 || ko >= 1) return;
    const ty = lerp(-180, 0, ki) - 180 * ko, by = lerp(1080, 900, ki) + 180 * ko;
    x.fillStyle = "#121212"; x.fillRect(0, ty, 1920, 172); x.fillRect(0, by, 1920, 184);
    const ta = prog(b, AT.thanks - 0.02, AT.thanks + 0.05);
    if (ta > 0) {
      K.text(x, tr("ch10.end1"), 960, ty + 106, { font: SANS(76), color: "#FFFFFF", align: "center", reveal: prog(b, AT.thanks, AT.thanks + 0.35), perChar: true, dim: 0, alpha: ta });
      for (let i = 0; i < 10; i++) { x.fillStyle = VAL[i] === rgba(PAL.nInk) ? "#8A847A" : VAL[i]; x.fillRect(660 + i * 60, ty + 140, 56 * prog(b, AT.thanks + 0.1 + i * 0.03, AT.thanks + 0.2 + i * 0.03), 8); }
    }
    const ca = prog(b, AT.credit - 0.02, AT.credit + 0.05);
    if (ca > 0) K.text(x, tr("ch10.end2"), 960, by + 108, { font: SANS(44, 500), color: "#E8E6E0", align: "center", reveal: prog(b, AT.credit, AT.credit + 0.4), perChar: true, dim: 0, alpha: ca });
  }

  F10.bow = function bow(f, b, { L, BAR, b00 }) {
    const S0 = ((window.CHAPTERS || []).find((c) => c.id === "ch00") || {}).share;
    const covered = b >= AT.drop + 0.34 + 9 * AT.dropStep && b < AT.lift;
    if (S0 && b >= AT.still) { S0.termFrame(f, S0.termState(0)); return; }
    if (S0 && !covered) { if (b < AT.lift) S0.paperFrame(f, b00, { hud: false, cameo: true }); else S0.termFrame(f, S0.termState(0)); }
    else G.clear([0.006, 0.006, 0.006]);
    G.setCam({ x: 960, y: 540, zoom: 1, rot: 0 });
    const x = L.begin();
    curtains(x, b, BAR);
    bands(x, b);
    G.composite(L.upload(), { mode: G.MODE.normal });
    f.post = { ...(S0 ? S0.cut.post : {}), shake: [0, 0], flash: 0, fade: 0, blur: [0, 0], zoomBlur: 0 };
  };
  F10.BOW_AT = AT;
})();

import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYSTATION_IMAGE_SCALE,
  playstationAvatar,
  playstationAvatarNeedsOptimizing,
  playstationImage,
} from "./playstation-image.ts";

const TROPHY =
  "https://psnobj.prod.dl.playstation.net/psnobj/NPWR31606_00/00b45e85-d31e-4e8d-bd39-9b81b2b610f9.png";
const COVER =
  "https://image.api.playstation.com/vulcan/ap/rnd/202511/2605/3d57b6ae9b22a4982f0272ef1c716ebbfee59b7ea1fe60af.png";
const AVATAR =
  "https://psn-rsc.prod.dl.playstation.net/psn-rsc/avatar/HP9008/CUSA03605_00-25ASIAPYMTCPN001_F85C6512DA4CA519FE74_xl.png";

const RECENT_PX = 28;
const AVATAR_PX = 40;

test("能按查询串缩放的主机补上展示尺寸，其它地址原样返回", () => {
  const recent = playstationImage(TROPHY, RECENT_PX * PLAYSTATION_IMAGE_SCALE);
  assert.equal(
    recent,
    `${TROPHY}?w=${RECENT_PX * PLAYSTATION_IMAGE_SCALE}&h=${RECENT_PX * PLAYSTATION_IMAGE_SCALE}`,
  );
  assert.equal(
    playstationImage(COVER, 128),
    `${COVER}?w=128&h=128`,
  );
  assert.equal(playstationImage(AVATAR, 84), AVATAR);
  assert.equal(playstationImage("not a url", 84), "not a url");
  assert.equal(playstationImage(null, 84), null);
});

test("头像从 xl 降到盖住 3x 展示尺寸的最小一档，不把小图改大", () => {
  const requested = AVATAR_PX * PLAYSTATION_IMAGE_SCALE;
  assert.equal(
    playstationAvatar(AVATAR, requested),
    AVATAR.replace("_xl.png", "_m.png"),
  );
  assert.equal(playstationAvatarNeedsOptimizing(AVATAR, requested), false);

  const medium = AVATAR.replace("_xl.png", "_m.png");
  assert.equal(playstationAvatar(medium, requested), medium);
  assert.equal(playstationAvatarNeedsOptimizing(medium, requested), false);

  const small = AVATAR.replace("_xl.png", "_s.png");
  assert.equal(playstationAvatar(small, requested), small);

  assert.equal(playstationAvatar(`${AVATAR}?v=1`, requested), `${AVATAR.replace("_xl.png", "_m.png")}?v=1`);
  assert.equal(playstationAvatar(AVATAR, 400), AVATAR);
  assert.equal(playstationAvatar(TROPHY, requested), TROPHY);
  assert.equal(playstationAvatar(null, requested), null);
});

test("认不出档位的 psn-rsc 头像仍走优化器，其它主机不走", () => {
  const opaque = "https://psn-rsc.prod.dl.playstation.net/psn-rsc/avatar/custom.png";
  assert.equal(playstationAvatar(opaque, 120), opaque);
  assert.equal(playstationAvatarNeedsOptimizing(opaque, 120), true);
  assert.equal(playstationAvatarNeedsOptimizing(TROPHY, 84), false);
  assert.equal(playstationAvatarNeedsOptimizing("not a url", 120), false);
});

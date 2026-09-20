import assert from "node:assert/strict";
import test from "node:test";

import { foldGameName, pickGameApplicationId } from "./game-name.ts";

test("parent 优先于壳 application", () => {
  assert.equal(
    pickGameApplicationId({
      name: "Beat Saber",
      applicationId: "1417273808645259344",
      parentApplicationId: "451991967149195264",
      applicationName: "Meta",
      detectableId: "451991967149195264",
    }),
    "451991967149195264",
  );
});

test("RPC 名和正在玩的一致就用 application_id", () => {
  assert.equal(
    pickGameApplicationId({
      name: "PRAGMATA",
      applicationId: "1448369915462549616",
      parentApplicationId: null,
      applicationName: "PRAGMATA",
      detectableId: null,
    }),
    "1448369915462549616",
  );
});

test("Quest 的 Meta 壳对不上时用 detectable 同名游戏", () => {
  assert.equal(
    pickGameApplicationId({
      name: "Beat Saber",
      applicationId: "1417273808645259344",
      parentApplicationId: null,
      applicationName: "Meta",
      detectableId: "451991967149195264",
    }),
    "451991967149195264",
  );
});

test("游戏本地化标题和 RPC 英文名不同时保留原 application_id", () => {
  assert.equal(
    pickGameApplicationId({
      name: "孤山独影",
      applicationId: "1440132103672172746",
      parentApplicationId: null,
      applicationName: "Ghost of Yotei",
      detectableId: null,
    }),
    "1440132103672172746",
  );
});

test("知道是壳又对不上 detectable 就不给 id，避免链到 Meta", () => {
  assert.equal(
    pickGameApplicationId({
      name: "Some Quest Game",
      applicationId: "1417273808645259344",
      parentApplicationId: null,
      applicationName: "Meta",
      detectableId: null,
    }),
    null,
  );
});

test("RPC 还没查到时保留原 application_id", () => {
  assert.equal(
    pickGameApplicationId({
      name: "PRAGMATA",
      applicationId: "1448369915462549616",
      parentApplicationId: null,
      applicationName: undefined,
      detectableId: null,
    }),
    "1448369915462549616",
  );
});

test("foldGameName 去掉商标和空白", () => {
  assert.equal(foldGameName("Beat Saber"), foldGameName("beat saber"));
  assert.equal(foldGameName("機戰傭兵™VI"), foldGameName("機戰傭兵VI"));
});

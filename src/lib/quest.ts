import { questMirror, questNow } from "@shared/quest";

export async function getQuestNow() {
  return questNow(await questMirror.get());
}

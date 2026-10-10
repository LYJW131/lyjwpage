import { codingModelName } from "@shared/coding-models";

function capitalize(part: string) {
  return part ? `${part[0].toUpperCase()}${part.slice(1)}` : part;
}

export function formatCodingModelName(model: string) {
  if (!model) return model;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${capitalize(family)} ${major}${minor ? `.${minor}` : ""}`;
  }
  const gpt = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/i.exec(model);
  if (gpt) {
    const [, version, variant] = gpt;
    const suffix = variant ? ` ${variant.split("-").map(capitalize).join(" ")}` : "";
    return `GPT ${version}${suffix}`;
  }
  return model.split("-").map(capitalize).join(" ");
}

export function codingModelLabel(model: string) {
  const name = codingModelName(model);
  if (name === "github_bugbot") return "Bugbot";
  if (name.startsWith("grok-bot-")) return "Grok Bot";
  if (name === "agent_review") return "Agent Review";
  return formatCodingModelName(name);
}

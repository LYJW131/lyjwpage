import { lazy, Suspense, type ComponentProps } from "react";

import type { AnswerCard as AnswerCardComponent, AskCard as AskCardComponent } from "@/components/ask-card";
import type { BuildPlanCard as BuildPlanCardComponent } from "@/components/build-plan-card";
import type { ChatCard as ChatCardComponent } from "@/components/chat-card";
import { reportError } from "@/lib/error-report";

function ChatCardUnavailable() {
  return (
    <div role="alert" className="flex items-center gap-3 py-2 text-sm">
      <span className="text-muted-foreground">This card could not load.</span>
      <button type="button" onClick={() => window.location.reload()} className="label-mono underline underline-offset-4">
        Reload
      </button>
    </div>
  );
}

function unavailable(error: unknown) {
  reportError(error, "boundary", { card: "Talk to God", component: "chat-card" });
  return { default: ChatCardUnavailable };
}

const loading = <div role="status" className="py-2 text-sm text-muted-foreground">Loading card…</div>;

const LazyAnswerCard = lazy(() =>
  import("@/components/ask-card").then((module) => ({ default: module.AnswerCard }), unavailable),
);
const LazyAskCard = lazy(() =>
  import("@/components/ask-card").then((module) => ({ default: module.AskCard }), unavailable),
);
const LazyBuildPlanCard = lazy(() =>
  import("@/components/build-plan-card").then((module) => ({ default: module.BuildPlanCard }), unavailable),
);
const LazyChatCard = lazy(() =>
  import("@/components/chat-card").then((module) => ({ default: module.ChatCard }), unavailable),
);

export function AnswerCard(props: ComponentProps<typeof AnswerCardComponent>) {
  return <Suspense fallback={loading}><LazyAnswerCard {...props} /></Suspense>;
}

export function AskCard(props: ComponentProps<typeof AskCardComponent>) {
  return <Suspense fallback={loading}><LazyAskCard {...props} /></Suspense>;
}

export function BuildPlanCard(props: ComponentProps<typeof BuildPlanCardComponent>) {
  return <Suspense fallback={loading}><LazyBuildPlanCard {...props} /></Suspense>;
}

export function ChatCard(props: ComponentProps<typeof ChatCardComponent>) {
  return <Suspense fallback={loading}><LazyChatCard {...props} /></Suspense>;
}

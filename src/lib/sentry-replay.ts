import { addIntegration, replayIntegration } from "@sentry/nextjs";

export function attachReplay(): void {
  addIntegration(
    replayIntegration({
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
    }),
  );
}

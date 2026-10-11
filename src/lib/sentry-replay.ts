import { addIntegration, replayIntegration } from "@sentry/react";

export function attachReplay(): void {
  addIntegration(
    replayIntegration({
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
    }),
  );
}

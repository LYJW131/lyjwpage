import type { PresenceReport } from "./presence.js";
import type { GatewayState } from "./gateway-state.js";
import type { MembershipCheck } from "./membership.js";

export class VerifiedHeartbeat {
  private running = false;
  private readonly state: GatewayState;
  private readonly membership: MembershipCheck;
  private readonly deliver: (presence: PresenceReport) => void;

  constructor(state: GatewayState, membership: MembershipCheck, deliver: (presence: PresenceReport) => void) {
    this.state = state;
    this.membership = membership;
    this.deliver = deliver;
  }

  async tick(observedAt?: number): Promise<void> {
    if (this.running) return;
    const observation = this.state.observation();
    if (!observation) return;
    this.running = true;
    try {
      const result = await this.membership(observation.guildId);
      if (result === "absent") {
        this.state.invalidateIfCurrent(observation);
      } else if (result === "present") {
        const snapshot = this.state.heartbeatIfCurrent(observation, observedAt ?? Date.now());
        if (snapshot) this.deliver(snapshot);
      }
    } finally {
      this.running = false;
    }
  }
}

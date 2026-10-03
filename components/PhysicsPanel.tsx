import { Panel } from "./ui/Panel";

// Lifetime, mean power, radiator area, and shield mass come from the physics service
// (Phase 5), called on the reduced orbit (Phase 6). Until that service is connected the
// panel says so and shows nothing in its place. It never invents a lifetime.
export function PhysicsPanel() {
  return (
    <Panel id="physics" title="Physics" eyebrow="Estimated, with assumptions">
      <p className="body">Physics unavailable.</p>
      <p className="body-sm rok-subtle">
        The physics service is not connected, so no lifetime, mean power, radiator area, or shield mass is
        shown. Nothing is estimated in its place.
      </p>
    </Panel>
  );
}

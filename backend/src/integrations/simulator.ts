// Reserved adapter boundary. The general guidance engine has no simulator dependency.
export interface SimulatorAdapter {
  connect(options: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  getTelemetry(): Promise<Record<string, string | number | boolean>>;
}
export const simulatorCapability = {
  available: false,
  status: "planned",
  description:
    "Simulator integration is reserved for a future adapter. Video and camera guidance are available now.",
};

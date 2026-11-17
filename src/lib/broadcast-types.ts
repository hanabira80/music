export type DeviceStatus = "idle" | "streaming" | "offline";

export type Transport = "stopped" | "playing" | "paused";

export type AudioSource =
  | { kind: "file"; id: string; name: string; mime: string }
  | { kind: "url"; url: string };

export type TransmissionLog = {
  id: string;
  at: string;
  classroomId: string;
  name: string;
  ip: string;
  action: string;
  status: number | null;
  latencyMs: number;
  ok: boolean;
  message: string;
  deviceStatus?: DeviceStatus;
};

export type BroadcastAction = "play" | "pause" | "stop" | "volume" | "tone";

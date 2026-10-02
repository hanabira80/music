"use client";

import { create } from "zustand";
import { DEFAULT_CLASSROOMS } from "@/config/classrooms";
import type {
  AudioSource,
  BroadcastAction,
  DeviceStatus,
  TransmissionLog,
  Transport,
} from "@/lib/broadcast-types";

type BroadcastState = {
  selected: Record<string, boolean>;
  status: Record<string, DeviceStatus>;
  probing: boolean;
  source: AudioSource | null;
  urlDraft: string;
  volume: number;
  transport: Transport;
  busy: boolean;
  notice: string;
  logs: TransmissionLog[];
  lanOrigin: string;
  toggle: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setUrlDraft: (value: string) => void;
  setVolume: (value: number) => void;
  setSourceFile: (source: Extract<AudioSource, { kind: "file" }>) => void;
  useUrlSource: () => void;
  pushLog: (entry: TransmissionLog) => void;
  probe: () => Promise<void>;
  loadHost: () => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  send: (action: BroadcastAction) => Promise<void>;
};

const initialSelected = Object.fromEntries(
  DEFAULT_CLASSROOMS.map((room) => [room.id, room.active]),
);

async function readNdjson(response: Response, onLine: (entry: TransmissionLog) => void) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "전송에 실패했습니다.");
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onLine(JSON.parse(line) as TransmissionLog);
    }
  }
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  selected: initialSelected,
  status: {},
  probing: true,
  source: null,
  urlDraft: "",
  volume: 70,
  transport: "stopped",
  busy: false,
  notice: "",
  logs: [],
  lanOrigin: "",
  toggle: (id) =>
    set((state) => ({
      selected: { ...state.selected, [id]: !state.selected[id] },
    })),
  selectAll: () =>
    set({
      selected: Object.fromEntries(DEFAULT_CLASSROOMS.map((room) => [room.id, true])),
    }),
  clearSelection: () =>
    set({
      selected: Object.fromEntries(DEFAULT_CLASSROOMS.map((room) => [room.id, false])),
    }),
  setUrlDraft: (urlDraft) => set({ urlDraft }),
  setVolume: (volume) => set({ volume }),
  setSourceFile: (source) => set({ source, notice: "" }),
  useUrlSource: () => {
    const url = get().urlDraft.trim();
    if (!url) {
      set({ notice: "소리 주소를 입력해 주세요." });
      return;
    }
    set({ source: { kind: "url", url }, notice: "" });
  },
  pushLog: (entry) =>
    set((state) => {
      const status = { ...state.status };
      if (entry.deviceStatus) status[entry.classroomId] = entry.deviceStatus;
      return { logs: [...state.logs, entry].slice(-200), status };
    }),
  loadHost: async () => {
    const response = await fetch("/api/host");
    if (!response.ok) return;
    const payload = (await response.json()) as { origin?: string };
    set({ lanOrigin: payload.origin ?? "" });
  },
  probe: async () => {
    set({ probing: true });
    try {
      const response = await fetch("/api/devices");
      const payload = (await response.json()) as {
        devices: { id: string; status: DeviceStatus; log: TransmissionLog }[];
      };
      const status: Record<string, DeviceStatus> = {};
      const logs: TransmissionLog[] = [];
      for (const device of payload.devices) {
        status[device.id] = device.status;
        logs.push(device.log);
      }
      set({ status, logs, probing: false });
    } catch {
      set({ probing: false, notice: "칠판 상태를 확인하지 못했습니다." });
    }
  },
  uploadFile: async (file) => {
    set({ busy: true, notice: "" });
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = (await response.json()) as {
        id?: string;
        name?: string;
        mime?: string;
        error?: string;
      };
      if (!response.ok || !payload.id || !payload.name || !payload.mime) {
        throw new Error(payload.error || "파일을 올리지 못했습니다.");
      }
      set({
        source: { kind: "file", id: payload.id, name: payload.name, mime: payload.mime },
        busy: false,
      });
    } catch (error) {
      set({
        busy: false,
        notice: error instanceof Error ? error.message : "파일을 올리지 못했습니다.",
      });
    }
  },
  send: async (action) => {
    const { selected, source, volume } = get();
    const classroomIds = Object.entries(selected)
      .filter(([, on]) => on)
      .map(([id]) => id);
    if (classroomIds.length === 0) {
      set({ notice: "보낼 반을 골라 주세요." });
      return;
    }
    if (action === "play" && !source) {
      set({ notice: "음원을 먼저 골라 주세요." });
      return;
    }

    set({ busy: true, notice: "" });
    try {
      const response = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, classroomIds, volume, source }),
      });
      let anyOk = false;
      await readNdjson(response, (entry) => {
        if (entry.ok && (entry.action === "Play" || entry.action === "Pause" || entry.action === "Stop")) {
          anyOk = true;
        }
        if (entry.ok && entry.action === "SetVolume" && action === "volume") anyOk = true;
        get().pushLog(entry);
      });
      set({
        busy: false,
        transport:
          action === "play" && anyOk
            ? "playing"
            : action === "pause" && anyOk
              ? "paused"
              : action === "stop" && anyOk
                ? "stopped"
                : get().transport,
        notice: anyOk ? "" : "고른 칠판이 응답하지 않았습니다.",
      });
    } catch (error) {
      set({
        busy: false,
        notice: error instanceof Error ? error.message : "전송에 실패했습니다.",
      });
    }
  },
}));

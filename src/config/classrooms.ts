export interface Classroom {
  id: string;
  name: string;
  ip: string;
  port: number;
  active: boolean;
}

export const CAST_PORT = 8009;
export const AIRPLAY_PORT = 51010;

export const DEFAULT_CLASSROOMS: Classroom[] = [
  { id: "c1", name: "2-7반", ip: "172.30.7.104", port: 1400, active: false },
  { id: "c2", name: "2-6반", ip: "172.30.8.20", port: 1400, active: false },
  { id: "c3", name: "2-8반", ip: "172.30.7.209", port: AIRPLAY_PORT, active: false },
  { id: "c4", name: "2-1반", ip: "172.30.5.24", port: AIRPLAY_PORT, active: false },
  { id: "c5", name: "9반", ip: "172.30.7.118", port: AIRPLAY_PORT, active: false },
];

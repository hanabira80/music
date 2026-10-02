"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_CLASSROOMS } from "@/config/classrooms";
import type { DeviceStatus } from "@/lib/broadcast-types";
import { useBroadcastStore } from "@/stores/broadcast-store";

const statusLabel: Record<DeviceStatus, string> = {
  idle: "대기",
  streaming: "송출 중",
  offline: "오프라인",
};

function statusVariant(status: DeviceStatus | undefined) {
  if (status === "streaming") return "default" as const;
  if (status === "offline") return "destructive" as const;
  return "secondary" as const;
}

export function ClassroomGrid() {
  const probing = useBroadcastStore((state) => state.probing);
  const selected = useBroadcastStore((state) => state.selected);
  const status = useBroadcastStore((state) => state.status);
  const toggle = useBroadcastStore((state) => state.toggle);
  const selectAll = useBroadcastStore((state) => state.selectAll);
  const clearSelection = useBroadcastStore((state) => state.clearSelection);
  const picked = Object.values(selected).filter(Boolean).length;

  return (
    <section className="flex min-h-[240px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl">교실</h2>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={selectAll}>
            전체 선택
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
            선택 해제
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{picked}개 반을 골랐습니다.</p>

      {probing ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {DEFAULT_CLASSROOMS.map((room) => (
            <div
              key={room.id}
              className="flex min-h-[108px] flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10"
            >
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-2 gap-3 lg:grid-cols-5"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.04 } } }}
        >
          {DEFAULT_CLASSROOMS.map((room) => {
            const on = Boolean(selected[room.id]);
            const deviceStatus = status[room.id] ?? "idle";
            return (
              <motion.button
                key={room.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(room.id)}
                variants={{
                  hidden: { opacity: 0, y: 6 },
                  show: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.2 }}
                className={`flex min-h-[108px] flex-col items-start gap-2 rounded-xl p-4 text-left ring-1 ${
                  on ? "bg-secondary ring-foreground" : "bg-card ring-foreground/10"
                }`}
              >
                <span className="text-base font-medium">{room.name}</span>
                <span className="text-xs text-muted-foreground">
                  {room.ip}:{room.port}
                </span>
                <Badge variant={statusVariant(deviceStatus)}>{statusLabel[deviceStatus]}</Badge>
              </motion.button>
            );
          })}
        </motion.div>
      )}
    </section>
  );
}

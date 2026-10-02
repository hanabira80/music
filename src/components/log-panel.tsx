"use client";

import { useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useBroadcastStore } from "@/stores/broadcast-store";

function clock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("ko-KR", { hour12: false });
}

export function LogPanel() {
  const logs = useBroadcastStore((state) => state.logs);
  const probing = useBroadcastStore((state) => state.probing);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-2xl">전송 기록</h2>
      <div className="h-52 overflow-auto rounded-xl bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
        {probing ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-4/5 bg-zinc-800" />
            <Skeleton className="h-3 w-3/5 bg-zinc-800" />
            <Skeleton className="h-3 w-2/3 bg-zinc-800" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-zinc-500">아직 기록이 없습니다.</p>
        ) : (
          logs.map((entry) => (
            <p key={entry.id} className={entry.ok ? "text-zinc-100" : "text-red-300"}>
              {clock(entry.at)} {entry.name} {entry.ip} {entry.status ?? "—"} {entry.latencyMs}
              ms {entry.action} {entry.message}
            </p>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}

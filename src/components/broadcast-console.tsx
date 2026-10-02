"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { ClassroomGrid } from "@/components/classroom-grid";
import { LogPanel } from "@/components/log-panel";
import { SourcePanel } from "@/components/source-panel";
import { useBroadcastStore } from "@/stores/broadcast-store";

export function BroadcastConsole() {
  const probe = useBroadcastStore((state) => state.probe);
  const loadHost = useBroadcastStore((state) => state.loadHost);

  useEffect(() => {
    void loadHost();
    void probe();
  }, [loadHost, probe]);

  return (
    <motion.main
      initial={false}
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl">교실 BGM</h1>
        <p className="text-sm text-muted-foreground">
          맥북과 전자칠판이 같은 와이파이에 있으면, 고른 반 스피커로만 배경음이 나갑니다.
        </p>
      </header>
      <SourcePanel />
      <ClassroomGrid />
      <LogPanel />
    </motion.main>
  );
}

"use client";

import { useState } from "react";
import { Pause, Play, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useBroadcastStore } from "@/stores/broadcast-store";

function sliderValue(next: number | readonly number[]) {
  return Array.isArray(next) ? next[0] : next;
}

export function SourcePanel() {
  const source = useBroadcastStore((state) => state.source);
  const urlDraft = useBroadcastStore((state) => state.urlDraft);
  const volume = useBroadcastStore((state) => state.volume);
  const busy = useBroadcastStore((state) => state.busy);
  const transport = useBroadcastStore((state) => state.transport);
  const notice = useBroadcastStore((state) => state.notice);
  const lanOrigin = useBroadcastStore((state) => state.lanOrigin);
  const lanSsid = useBroadcastStore((state) => state.lanSsid);
  const setUrlDraft = useBroadcastStore((state) => state.setUrlDraft);
  const setVolume = useBroadcastStore((state) => state.setVolume);
  const useUrlSource = useBroadcastStore((state) => state.useUrlSource);
  const uploadFile = useBroadcastStore((state) => state.uploadFile);
  const selected = useBroadcastStore((state) => state.selected);
  const send = useBroadcastStore((state) => state.send);
  const picked = Object.values(selected).filter(Boolean).length;
  const [dragOver, setDragOver] = useState(false);

  const sourceLabel =
    source?.kind === "file" ? source.name : source?.kind === "url" ? source.url : "아직 없음";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">음원</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center ${
            dragOver ? "border-primary bg-muted" : "border-border"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file) void uploadFile(file);
          }}
        >
          <Upload className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">MP3나 WAV를 여기에 놓기</span>
          <span className="text-xs text-muted-foreground">또는 눌러서 고르기</span>
          <input
            className="sr-only"
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
        </label>

        <div className="flex flex-col gap-2">
          <Label htmlFor="stream-url">소리 주소</Label>
          <div className="flex gap-2">
            <Input
              id="stream-url"
              placeholder="https://example.com/bgm.mp3"
              value={urlDraft}
              onChange={(event) => setUrlDraft(event.target.value)}
            />
            <Button type="button" variant="outline" onClick={useUrlSource}>
              사용
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            이미 뽑아 둔 MP3 주소를 넣으면 맥북이 받아서 칠판으로 넘깁니다.
          </p>
        </div>

        <p className="text-sm">
          고른 음원 <span className="font-medium">{sourceLabel}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          MP3로 보내면 칠판은 화면을 나누지 않고 소리만 냅니다.
          {lanOrigin ? ` 이 맥 주소 ${lanOrigin}${lanSsid ? ` · SSID ${lanSsid}` : ""}` : ""}
        </p>

        <div className="flex flex-col gap-2">
          <Button type="button" size="lg" variant="secondary" disabled={busy} onClick={() => void send("tone")}>
            2-7반 시험음
          </Button>
          <p className="text-xs text-muted-foreground">
            2-7반만. 51010 상태 답장에 적힌 포트로 3초를 넣습니다. 번호가 없으면 소리를 보내지 않습니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="lg"
            disabled={busy || !source || picked === 0}
            onClick={() => void send("play")}
          >
            <Play />
            재생
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            disabled={busy || transport !== "playing"}
            onClick={() => void send("pause")}
          >
            <Pause />
            일시정지
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={busy || transport === "stopped"}
            onClick={() => void send("stop")}
          >
            <Square />
            정지
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <Label className="w-10">음량</Label>
          <Slider
            aria-label="음량"
            min={0}
            max={100}
            disabled={busy || picked === 0}
            value={[volume]}
            onValueChange={(next) => setVolume(sliderValue(next))}
            onValueCommitted={(next) => {
              setVolume(sliderValue(next));
              void send("volume");
            }}
          />
          <span className="w-8 text-right text-sm tabular-nums">{volume}</span>
        </div>
        {notice ? <p className="text-sm text-destructive">{notice}</p> : null}
      </CardContent>
    </Card>
  );
}

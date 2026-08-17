'use client';

// ============================================================
// VoiceMessagePlayer — custom WhatsApp-style audio bubble replacing
// the native <audio controls>. The playback-speed choice is
// deliberately GLOBAL and PERSISTENT (per client's request): clicking
// the speed button on any one voice message changes it for every
// voice message — current and future — until changed again. Synced
// across every mounted player via a localStorage value + a same-tab
// CustomEvent (storage events don't fire in the tab that wrote them).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const SPEED_STORAGE_KEY = 'divarytalk:audio-playback-rate';
const SPEED_CHANGE_EVENT = 'divarytalk:audio-speed-changed';
const SPEEDS = [1, 1.5, 2] as const;

function readStoredSpeed(): number {
  if (typeof window === 'undefined') return 1;
  const raw = Number(window.localStorage.getItem(SPEED_STORAGE_KEY));
  return SPEEDS.includes(raw as (typeof SPEEDS)[number]) ? raw : 1;
}

function broadcastSpeed(speed: number) {
  window.localStorage.setItem(SPEED_STORAGE_KEY, String(speed));
  window.dispatchEvent(new CustomEvent<number>(SPEED_CHANGE_EVENT, { detail: speed }));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VoiceMessagePlayer({ url, tone = 'muted' }: { url: string; tone?: 'muted' | 'primary' }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  // Lazy initializer (not an effect) — this component only ever
  // mounts client-side (inside a fetched message thread), so there's
  // no SSR/hydration mismatch to guard against here.
  const [speed, setSpeed] = useState(() => readStoredSpeed());

  // Apply the persisted rate once the <audio> element exists.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // Stay in sync when the speed changes from ANY player on the page.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<number>).detail;
      setSpeed(next);
      if (audioRef.current) audioRef.current.playbackRate = next;
    };
    window.addEventListener(SPEED_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SPEED_CHANGE_EVENT, onChange);
  }, []);

  function cycleSpeed() {
    const idx = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
    broadcastSpeed(next);
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.playbackRate = speed;
      void el.play();
    } else {
      el.pause();
    }
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(e.target.value);
    el.currentTime = t;
    setCurrentTime(t);
  }

  const isPrimary = tone === 'primary';
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex w-56 items-center gap-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className={
          isPrimary
            ? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/20 text-primary-foreground'
            : 'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
        }
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-0.5" />}
      </button>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={handleScrub}
        className="h-1 flex-1 cursor-pointer accent-current"
        style={{
          background: `linear-gradient(to right, currentColor ${progressPct}%, transparent ${progressPct}%)`,
        }}
        aria-label="Progresso do áudio"
      />

      <span className={isPrimary ? 'text-[10px] text-primary-foreground/80' : 'text-[10px] text-muted-foreground'}>
        {formatTime(playing || currentTime > 0 ? currentTime : duration)}
      </span>

      <button
        type="button"
        onClick={cycleSpeed}
        title="Velocidade de reprodução — vale para todos os áudios"
        className={
          isPrimary
            ? 'shrink-0 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground'
            : 'shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground'
        }
      >
        {speed}x
      </button>
    </div>
  );
}

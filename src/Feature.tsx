import { useEffect, useRef, useState } from "react";
import { commit, randomSalt, type MeshConfig, type YRoom } from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Presence = {
  /** True when the peer's front camera detects a face right now. */
  faceVisible: boolean;
  /** Mesh-time ms when face was first continuously visible in this session. */
  faceSince: number;
  name: string;
};

type MeetToken = {
  pair: string;
  ts: number;
  hash: string;
};

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;
const MUTUAL_HOLD_MS = 5_000;

interface BrowserFaceDetectorCtor {
  new (init?: { fastMode?: boolean; maxDetectedFaces?: number }): {
    detect: (
      source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    ) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
  };
}

function getFaceDetector(): BrowserFaceDetectorCtor | null {
  const w = window as unknown as { FaceDetector?: BrowserFaceDetectorCtor };
  return w.FaceDetector ?? null;
}

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="ec-screen">
        <h1>eye contact</h1>
        <p className="ec-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [armed, setArmed] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const [faceSince, setFaceSince] = useState(0);
  const [hasFaceDetector] = useState(() => getFaceDetector() !== null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const saltRef = useRef<string>(randomSalt());
  const hashRef = useRef<string>("");

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    void commit("eye-contact-token", saltRef.current).then(({ hash }) => {
      hashRef.current = hash;
    });
  }, []);

  useEffect(() => {
    const yPresence = room.doc.getMap<Presence>("presence");
    const yMeets = room.doc.getMap<MeetToken>("meets");
    const onChange = () => rerender((n) => n + 1);
    yPresence.observe(onChange);
    yMeets.observe(onChange);
    return () => {
      yPresence.unobserve(onChange);
      yMeets.unobserve(onChange);
    };
  }, [room]);

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    let consecutiveOn = 0;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const fd = hasFaceDetector ? new (getFaceDetector() as BrowserFaceDetectorCtor)() : null;
        const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
        const loop = async () => {
          const v = videoRef.current;
          if (v && v.videoWidth > 0) {
            let faceVisible = false;
            if (fd) {
              try {
                const r = await fd.detect(v);
                faceVisible = r.length > 0;
              } catch {
                faceVisible = false;
              }
            } else {
              faceVisible = true;
            }
            if (faceVisible) {
              consecutiveOn++;
              if (consecutiveOn === 1) setFaceSince(Date.now());
            } else {
              consecutiveOn = 0;
              setFaceSince(0);
            }
            room.doc.getMap<Presence>("presence").set(room.peerId, {
              faceVisible,
              faceSince: faceVisible ? Date.now() - (consecutiveOn - 1) * 200 : 0,
              name: myName,
            });
          }
          if (!cancelled) timerRef.current = window.setTimeout(loop, 200) as unknown as number;
        };
        loop();
      } catch (err) {
        setPermError(`Camera denied: ${(err as Error).message}`);
        setArmed(false);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      room.doc.getMap<Presence>("presence").delete(room.peerId);
    };
  }, [armed, hasFaceDetector, name, room]);

  useEffect(() => {
    if (!armed) return;
    const myFaceOn = faceSince > 0 && Date.now() - faceSince >= MUTUAL_HOLD_MS;
    if (!myFaceOn) return;
    const yPresence = room.doc.getMap<Presence>("presence");
    const yMeets = room.doc.getMap<MeetToken>("meets");
    yPresence.forEach((p, peerId) => {
      if (peerId === room.peerId) return;
      if (!p.faceVisible) return;
      if (p.faceSince === 0) return;
      if (Date.now() - p.faceSince < MUTUAL_HOLD_MS) return;
      const pair = [room.peerId, peerId].sort().join("|");
      if (yMeets.has(pair)) return;
      yMeets.set(pair, { pair, ts: Date.now(), hash: hashRef.current });
    });
  }, [faceSince, armed, room]);

  const presence: Array<{ id: string; p: Presence }> = [];
  room.doc.getMap<Presence>("presence").forEach((p, id) => presence.push({ id, p }));
  presence.sort((a, b) => a.id.localeCompare(b.id));

  const meets: MeetToken[] = [];
  room.doc.getMap<MeetToken>("meets").forEach((m) => meets.push(m));
  meets.sort((a, b) => b.ts - a.ts);

  const myFaceTime = faceSince > 0 ? Math.floor((Date.now() - faceSince) / 1000) : 0;

  return (
    <div className="ec-screen">
      <header className="ec-header">
        <h1>eye contact</h1>
        <input
          className="ec-name"
          placeholder="your name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
      </header>

      {!armed && (
        <>
          <button type="button" className="ec-arm" onClick={() => setArmed(true)}>
            arm front camera
          </button>
          {permError && <p className="ec-error">{permError}</p>}
          <p className="ec-help">
            {hasFaceDetector
              ? "Your browser supports the Face Detection API. Hold mutual eye contact with another person in the room for 5 seconds and a token is minted in both phones."
              : "Your browser doesn't expose FaceDetector — running in manual mode (camera on = face on). MediaPipe WASM fallback is a Phase 2 upgrade."}
          </p>
        </>
      )}

      {armed && (
        <>
          <video ref={videoRef} className="ec-preview" playsInline muted />
          <p className="ec-readout">
            face: <strong>{myFaceTime > 0 ? `${myFaceTime}s held` : "no"}</strong> ·{" "}
            {Math.max(0, presence.length - 1)} other peer{presence.length === 2 ? "" : "s"} on
            camera
          </p>
          <button type="button" className="ec-disarm" onClick={() => setArmed(false)}>
            disarm
          </button>
        </>
      )}

      <h2 className="ec-h2">recent meets</h2>
      <ul className="ec-meets">
        {meets.length === 0 && <li className="ec-empty">no mutual 5-second holds yet</li>}
        {meets.map((m) => {
          const ids = m.pair.split("|");
          const names = ids.map((id) => {
            const found = presence.find((p) => p.id === id);
            return found?.p.name ?? `peer-${id.slice(0, 4)}`;
          });
          const mine = ids.includes(room.peerId);
          return (
            <li key={m.pair} className={mine ? "is-mine" : ""}>
              <span className="ec-meet-pair">{names.join(" ↔ ")}</span>
              <span className="ec-meet-hash">#{m.hash.slice(0, 8)}</span>
              <span className="ec-meet-time">{new Date(m.ts).toLocaleTimeString()}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

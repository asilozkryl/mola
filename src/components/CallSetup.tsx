import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Square } from "lucide-react";
import type { CallController } from "../lib/useCall";
import { monitorAudio } from "../lib/audioMeter";
import { Modal } from "./ui";
import "./call.css";

type OutputDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};
export const canSelectOutput = () =>
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype;

export function MediaSettings({
  call,
  beforeInputChange,
  refreshKey = 0,
}: {
  call: CallController;
  beforeInputChange?: () => void;
  refreshKey?: number;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => {
          if (active) setDevices(list);
        })
        .catch(() => {});
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, [call.localStream, refreshKey]);
  const inputs = devices.filter(
    (device) => device.kind === "audioinput" && device.deviceId,
  );
  const outputs = devices.filter(
    (device) => device.kind === "audiooutput" && device.deviceId,
  );
  const changeOutput = async (id: string) => {
    setError("");
    setBusy(true);
    try {
      const probe = document.createElement("audio");
      await probe.setSinkId(id);
      call.setPreferences({ outputDeviceId: id });
    } catch {
      setError(
        "Bu hoparlör seçilemedi. Tarayıcının ses çıkışı iznini ve cihaz bağlantısını kontrol edin.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="call-device-settings">
      <label>
        Mikrofon
        <select
          value={call.preferences.inputDeviceId}
          disabled={busy || call.mediaBusy}
          onChange={(event) => {
            const value = event.target.value;
            beforeInputChange?.();
            setError("");
            setBusy(true);
            void call
              .selectInputDevice(value)
              .catch((err: unknown) =>
                setError(
                  err instanceof Error
                    ? err.message
                    : "Mikrofon değiştirilemedi.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <option value="">Sistem varsayılanı</option>
          {inputs.map((device, index) => (
            <option value={device.deviceId} key={device.deviceId}>
              {device.label || `Mikrofon ${index + 1}`}
            </option>
          ))}
          {call.preferences.inputDeviceId &&
            !inputs.some(
              (device) => device.deviceId === call.preferences.inputDeviceId,
            ) && (
              <option value={call.preferences.inputDeviceId}>
                Seçili mikrofon (bağlantısını kontrol edin)
              </option>
            )}
        </select>
      </label>
      <label>
        Hoparlör
        <select
          value={call.preferences.outputDeviceId}
          disabled={busy || !canSelectOutput()}
          onChange={(event) => void changeOutput(event.target.value)}
        >
          <option value="">Sistem varsayılanı</option>
          {outputs.map((device, index) => (
            <option value={device.deviceId} key={device.deviceId}>
              {device.label || `Hoparlör ${index + 1}`}
            </option>
          ))}
          {call.preferences.outputDeviceId &&
            !outputs.some(
              (device) => device.deviceId === call.preferences.outputDeviceId,
            ) && (
              <option value={call.preferences.outputDeviceId}>
                Seçili hoparlör
              </option>
            )}
        </select>
      </label>
      {!canSelectOutput() && (
        <p className="call-device-help">
          Bu tarayıcıda hoparlörü sisteminizin ses ayarlarından
          değiştirebilirsiniz.
        </p>
      )}
      {canSelectOutput() &&
        typeof (navigator.mediaDevices as OutputDevices | undefined)
          ?.selectAudioOutput === "function" && (
          <button
            type="button"
            className="call-secondary"
            disabled={busy}
            onClick={() => {
              setError("");
              void (navigator.mediaDevices as OutputDevices)
                .selectAudioOutput!()
                .then((device) => {
                  setDevices((list) => [
                    ...list.filter((item) => item.deviceId !== device.deviceId),
                    device,
                  ]);
                  return changeOutput(device.deviceId);
                })
                .catch(() =>
                  setError(
                    "Hoparlör seçimi tamamlanmadı. Sistem varsayılanıyla devam edebilirsiniz.",
                  ),
                );
            }}
          >
            Başka bir hoparlör seç
          </button>
        )}
      <p className="call-device-help">
        Cihaz adları mikrofon izninden sonra görünür. Değişiklikler bu
        tarayıcıdaki görüşmeler için geçerlidir.
      </p>
      {error && (
        <p className="call-device-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CallSetup({
  call,
  channel,
  onJoin,
  onClose,
}: {
  call: CallController;
  channel: { id: string; name: string };
  onJoin: () => void;
  onClose: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const cleanup = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const stop = () => {
    generation.current++;
    cleanup.current?.();
    cleanup.current = null;
    if (mounted.current) {
      setTesting(false);
      setBusy(false);
      setLevel(0);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      cleanup.current?.();
      cleanup.current = null;
    };
  }, []);
  const testMicrophone = async () => {
    stop();
    setBusy(true);
    setError("");
    const version = generation.current;
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Mikrofon testi için HTTPS ve güncel bir tarayıcı gerekli.",
        );
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          ...(call.preferences.inputDeviceId
            ? { deviceId: { exact: call.preferences.inputDeviceId } }
            : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!mounted.current || version !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const disposeMeter = monitorAudio([{ id: "test", stream }], (levels) =>
        setLevel(Math.min(100, Math.round((levels.test ?? 0) * 500))),
      );
      const captured = stream;
      cleanup.current = () => {
        disposeMeter();
        captured.getTracks().forEach((track) => track.stop());
      };
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            stop();
            setError("Mikrofon bağlantısı kesildi. Cihazınızı kontrol edin.");
          },
          { once: true },
        ),
      );
      setTesting(true);
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mounted.current && version === generation.current)
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Mikrofon izni verilmedi. Site izinlerinden mikrofonu açıp tekrar deneyin."
            : err instanceof Error && !(err instanceof DOMException)
              ? err.message
              : "Mikrofon başlatılamadı. Cihaz bağlantısını ve site izinlerini kontrol edin.",
        );
    } finally {
      if (mounted.current && version === generation.current) setBusy(false);
    }
  };
  return (
    <Modal
      title="Görüşmeye hazırlan"
      onClose={() => {
        stop();
        onClose();
      }}
    >
      <div className="call-preflight">
        <div className="call-preflight-room">
          <span>
            <Headphones size={22} />
          </span>
          <div>
            <strong>{channel.name}</strong>
            <p>Katılmadan önce sesini kontrol edebilirsin.</p>
          </div>
        </div>
        <MediaSettings
          call={call}
          beforeInputChange={stop}
          refreshKey={Number(testing)}
        />
        <div className="call-mic-test">
          <div>
            <strong>Mikrofon testi</strong>
            <small>
              {testing
                ? "Konuşurken ses seviyesi hareket eder."
                : "Sesin kaydedilmez ve diğer üyelere gönderilmez."}
            </small>
          </div>
          <div
            className="call-level-meter"
            role="meter"
            aria-label="Mikrofon ses seviyesi"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level}
          >
            <span style={{ width: `${level}%` }} />
          </div>
          <button
            type="button"
            className="call-secondary"
            disabled={busy}
            onClick={() => (testing ? stop() : void testMicrophone())}
          >
            {testing ? <Square size={15} /> : <Mic size={15} />}
            {testing
              ? "Testi durdur"
              : busy
                ? "Mikrofon bekleniyor…"
                : "Mikrofonu test et"}
          </button>
        </div>
        <label className="call-muted-choice">
          <input
            type="checkbox"
            checked={call.preferences.startMuted}
            onChange={(event) =>
              call.setPreferences({ startMuted: event.target.checked })
            }
          />
          Mikrofonum kapalı katıl
        </label>
        {error && (
          <p className="call-device-error" role="alert">
            {error}
          </p>
        )}
        <div className="call-preflight-actions">
          <button
            className="call-secondary"
            onClick={() => {
              stop();
              onClose();
            }}
          >
            Vazgeç
          </button>
          <button
            className="call-primary"
            disabled={!call.canJoin}
            onClick={() => {
              stop();
              onJoin();
            }}
          >
            <Headphones size={17} />
            Görüşmeye katıl
          </button>
        </div>
      </div>
    </Modal>
  );
}

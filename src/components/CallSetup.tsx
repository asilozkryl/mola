import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Headphones,
  Mic,
  MicOff,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import type { CallController } from "../lib/useCall";
import { monitorAudio } from "../lib/audioMeter";
import { Modal } from "./ui";
import "./call.css";
import "./call-setup-polish.css";

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
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const operation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      locked.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const version = ++revision;
      setLoading(true);
      try {
        const list = await navigator.mediaDevices?.enumerateDevices();
        if (active && version === revision) {
          setDevices(list ?? []);
          setNotice(
            list
              ? ""
              : "Cihaz listesi kullanılamıyor. Sistem varsayılanıyla devam edebilirsin.",
          );
        }
      } catch {
        if (active && version === revision)
          setNotice(
            "Cihaz listesi alınamadı. Cihaz bağlantısını kontrol edip ses ayarlarını yeniden aç.",
          );
      } finally {
        if (active && version === revision) setLoading(false);
      }
    };
    void refresh();
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
  const performChange = async (
    action: (isCurrent: () => boolean) => Promise<void>,
    message: string,
  ) => {
    if (locked.current || call.mediaBusy) return;
    locked.current = true;
    const version = ++operation.current;
    const isCurrent = () => mounted.current && version === operation.current;
    setError("");
    setBusy(true);
    try {
      await action(isCurrent);
    } catch (err) {
      if (isCurrent())
        setError(
          err instanceof Error && !(err instanceof DOMException)
            ? err.message
            : message,
        );
    } finally {
      if (isCurrent()) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const changeOutput = (id: string) =>
    performChange(async (isCurrent) => {
      const probe = document.createElement("audio");
      await probe.setSinkId(id);
      if (isCurrent()) call.setPreferences({ outputDeviceId: id });
    }, "Bu hoparlör seçilemedi. Tarayıcının ses çıkışı iznini ve cihaz bağlantısını kontrol et.");
  return (
    <div
      className="call-device-settings call-device-settings-polished"
      aria-busy={busy}
    >
      <label>
        Mikrofon
        <NativeSelect
          unstyled
          value={call.preferences.inputDeviceId}
          disabled={busy || call.mediaBusy || loading}
          onChange={(event) => {
            const value = event.target.value;
            void performChange(async () => {
              beforeInputChange?.();
              await call.selectInputDevice(value);
            }, "Mikrofon değiştirilemedi. Cihaz bağlantısını kontrol et.");
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
        </NativeSelect>
      </label>
      <label>
        Hoparlör
        <NativeSelect
          unstyled
          value={call.preferences.outputDeviceId}
          disabled={busy || call.mediaBusy || loading || !canSelectOutput()}
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
        </NativeSelect>
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
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className="call-secondary"
            disabled={busy || call.mediaBusy}
            onClick={() => {
              void performChange(async (isCurrent) => {
                const device = await (navigator.mediaDevices as OutputDevices)
                  .selectAudioOutput!();
                if (!isCurrent()) return;
                const probe = document.createElement("audio");
                await probe.setSinkId(device.deviceId);
                if (!isCurrent()) return;
                setDevices((list) => [
                  ...list.filter((item) => item.deviceId !== device.deviceId),
                  device,
                ]);
                call.setPreferences({ outputDeviceId: device.deviceId });
              }, "Hoparlör seçimi tamamlanmadı. Sistem varsayılanıyla devam edebilirsin.");
            }}
          >
            Başka bir hoparlör seç
          </Button>
        )}
      <p className="call-device-help">
        Cihaz adları mikrofon izninden sonra görünür. Seçimin bu tarayıcıdaki
        sonraki görüşmelerde kullanılır.
      </p>
      {(loading || busy || notice) && (
        <p className="call-device-help" role="status">
          {busy
            ? "Cihaz değiştiriliyor…"
            : loading
              ? "Cihazlar yükleniyor…"
              : notice}
        </p>
      )}
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
  participantCount,
  capacity,
  connected = true,
  replacingSession = false,
  onJoin,
  onClose,
}: {
  call: CallController;
  channel: { id: string; name: string };
  participantCount?: number;
  capacity?: number;
  connected?: boolean;
  replacingSession?: boolean;
  onJoin: () => void;
  onClose: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [heardAudio, setHeardAudio] = useState(false);
  const [tested, setTested] = useState(false);
  const settingsId = useId();
  const modeHelpId = useId();
  const full =
    !replacingSession &&
    participantCount !== undefined &&
    capacity !== undefined &&
    participantCount >= capacity;
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
    setHeardAudio(false);
    setTested(false);
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
      if (!stream.getAudioTracks().some((track) => track.readyState === "live"))
        throw new Error("Mikrofon bulunamadı. Cihazını bağlayıp tekrar dene.");
      const disposeMeter = monitorAudio([{ id: "test", stream }], (levels) => {
        if (!mounted.current || version !== generation.current) return;
        const measured = Math.min(100, Math.round((levels.test ?? 0) * 500));
        setLevel(measured);
        if (measured > 3) setHeardAudio(true);
      });
      const captured = stream;
      cleanup.current = () => {
        disposeMeter();
        captured.getTracks().forEach((track) => track.stop());
      };
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (!mounted.current || version !== generation.current) return;
            stop();
            setTested(false);
            setError("Mikrofon bağlantısı kesildi. Cihazınızı kontrol edin.");
          },
          { once: true },
        ),
      );
      setTesting(true);
      setTested(true);
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      if (mounted.current && version === generation.current)
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Mikrofon izni verilmedi. Site izinlerinden mikrofonu açıp tekrar deneyin."
            : err instanceof DOMException && err.name === "NotFoundError"
              ? "Mikrofon bulunamadı. Cihazını bağlayıp tekrar dene."
              : err instanceof DOMException &&
                  err.name === "OverconstrainedError"
                ? "Seçili mikrofon kullanılamıyor. Ses ayarlarından başka bir mikrofon seç."
                : err instanceof DOMException && err.name === "NotReadableError"
                  ? "Mikrofon başka bir uygulamada kullanılıyor olabilir. Cihazını kontrol edip tekrar dene."
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
      <div className="call-preflight call-preflight-polished">
        <div className="call-preflight-room">
          <span>
            <Headphones size={19} />
          </span>
          <div>
            <strong>{channel.name}</strong>
            <p>
              {!connected
                ? "Bağlantı bekleniyor. Katılımcılar güncellenemiyor."
                : participantCount === undefined
                  ? "Katılmadan önce sesini kontrol edebilirsin."
                  : participantCount === 0
                    ? "Henüz kimse yok. Görüşmeyi sen başlat."
                    : `${participantCount} kişi görüşmede${capacity ? ` · En fazla ${capacity} kişi` : ""}`}
            </p>
          </div>
        </div>
        <div className="call-join-mode">
          <span className="call-join-mode-icon" aria-hidden="true">
            {call.preferences.startMuted ? (
              <MicOff size={19} />
            ) : (
              <Mic size={19} />
            )}
          </span>
          <div>
            <label className="call-muted-choice">
              <input
                type="checkbox"
                checked={call.preferences.startMuted}
                aria-describedby={modeHelpId}
                onChange={(event) =>
                  call.setPreferences({ startMuted: event.target.checked })
                }
              />
              Mikrofonum kapalı katıl
            </label>
            <p id={modeHelpId}>
              {call.preferences.startMuted
                ? "Mikrofon izni gerekir; sesin kapalı başlar."
                : "Katıldığında mikrofonun açık olacak."}{" "}
              Kameran kapalı başlar.
            </p>
          </div>
        </div>
        <div className="call-mic-test">
          <div className="call-mic-test-row">
            <div>
              <strong>Sesini kontrol et</strong>
              <small>İsteğe bağlı; sesin kaydedilmez veya paylaşılmaz.</small>
            </div>
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              className="call-secondary"
              onClick={() => (testing || busy ? stop() : void testMicrophone())}
            >
              {testing || busy ? <Square size={14} /> : <Mic size={14} />}
              {testing
                ? "Testi durdur"
                : busy
                  ? "Testi iptal et"
                  : "Mikrofonu test et"}
            </Button>
          </div>
          <div
            className="call-level-meter"
            role="meter"
            aria-label="Mikrofon ses seviyesi"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level}
            aria-valuetext={
              testing
                ? `${level} / 100`
                : busy
                  ? "Mikrofon izni bekleniyor"
                  : "Test çalışmıyor"
            }
          >
            <span style={{ width: `${level}%` }} />
          </div>
          <p
            className={`call-test-status${heardAudio && tested && !busy ? " call-test-status-detected" : ""}`}
            role="status"
          >
            {heardAudio && tested && !busy && (
              <Check size={13} aria-hidden="true" />
            )}
            {busy
              ? "Mikrofon izni bekleniyor. Tarayıcıdaki izin isteğini kontrol et."
              : testing
                ? heardAudio
                  ? "Ses algılandı. Konuşurken seviyeyi takip edebilirsin."
                  : "Konuş ve mikrofon seviyesini kontrol et."
                : tested
                  ? heardAudio
                    ? "Test tamamlandı, ses algılandı."
                    : "Test tamamlandı. Ses algılanmadı; mikrofonunu kontrol et."
                  : "Henüz test edilmedi."}
          </p>
        </div>
        {error && (
          <p className="call-device-error" role="alert">
            {error}
          </p>
        )}
        <div className="call-setup-devices">
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className="call-setup-disclosure"
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            Ses ayarları
            <ChevronDown size={15} aria-hidden="true" />
          </Button>
          <div id={settingsId} hidden={!settingsOpen}>
            {settingsOpen && (
              <MediaSettings
                call={call}
                beforeInputChange={() => {
                  stop();
                  setHeardAudio(false);
                  setTested(false);
                  setError("");
                }}
                refreshKey={Number(testing)}
              />
            )}
          </div>
        </div>
        {(full || !call.canJoin) && (
          <p className="call-device-error" role="status">
            {!connected
              ? "Görüşmeye katılmak için bağlantının yeniden kurulmasını bekle."
              : full
                ? "Bu görüşme şu an dolu. Bir kişi ayrıldığında katılabilirsin."
                : "Şu an görüşmeye katılamıyorsun. Kanal erişimini kontrol et."}
          </p>
        )}
        <p className="call-device-hint">
          Başka bir cihazında görüşmedeysen katıldığında görüşme otomatik olarak
          buraya geçer ve önceki cihazın bağlantısı kapanır.
        </p>
        <div className="call-preflight-actions">
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="call-secondary"
            onClick={() => {
              stop();
              onClose();
            }}
          >
            Vazgeç
          </Button>
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="call-primary"
            disabled={!call.canJoin || full}
            onClick={() => {
              stop();
              onJoin();
            }}
          >
            <Headphones size={17} />
            Görüşmeye katıl
          </Button>
        </div>
      </div>
    </Modal>
  );
}

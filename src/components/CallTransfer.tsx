import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  Laptop,
  LoaderCircle,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui";
import type { CallController } from "../lib/useCall";
import type { CallDevice } from "../../shared/call-types";
import "./call-transfer.css";

function DeviceIcon({ name }: { name: string }) {
  return /android|ios|iphone|ipad|mobile/i.test(name) ? (
    <Smartphone size={21} />
  ) : (
    <Laptop size={21} />
  );
}

function TransferTime({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <small>
      {Math.max(0, Math.ceil((expiresAt - now) / 1000))} sn içinde kabul
      edilmeli
    </small>
  );
}

export function CallTransferDevices({
  call,
  onClose,
}: {
  call: CallController;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<CallDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void call
      .getTransferDevices()
      .then((list) => {
        if (active) setDevices(list);
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Cihazlar alınamadı. Yeniden deneyin.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [call.getTransferDevices, call.devicesRevision, refresh]);
  const pending =
    call.transfer?.direction === "outgoing" ? call.transfer.details : null;
  return (
    <section
      className="call-transfer-section"
      aria-label="Görüşmeyi başka cihaza aktar"
      id="call-transfer-devices"
      tabIndex={-1}
    >
      <div className="call-transfer-heading">
        <div>
          <strong>
            <ArrowRightLeft size={18} /> Başka cihazda devam et
          </strong>
          <p>Diğer cihaz hazır olduğunda bu cihaz görüşmeden ayrılır.</p>
        </div>
        <Button
          variant="unstyled"
          size="unset"
          className="call-icon-button"
          aria-label="Cihaz listesini kapat"
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </div>
      {pending ? (
        <div className="call-transfer-pending" role="status">
          <span className="call-transfer-device-icon">
            <LoaderCircle className="spin" size={21} />
          </span>
          <div>
            <strong>{pending.targetDevice}</strong>
            <p>Diğer cihazda aktarımı kabul et.</p>
            <TransferTime expiresAt={pending.expiresAt} />
          </div>
          <Button
            variant="unstyled"
            size="unset"
            className="secondary-button"
            onClick={call.cancelTransfer}
          >
            Aktarımı iptal et
          </Button>
        </div>
      ) : (
        <>
          <div className="call-transfer-list-title">
            <span>Hazır cihazların</span>
            <Button
              variant="unstyled"
              size="unset"
              className="text-button"
              disabled={loading || call.transferRequesting}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} /> Yenile
            </Button>
          </div>
          {error ? (
            <p role="alert">{error}</p>
          ) : loading ? (
            <p role="status">Cihazlar aranıyor…</p>
          ) : devices.length ? (
            <div className="call-transfer-device-list">
              {devices.map((device) => (
                <Button
                  key={device.id}
                  variant="unstyled"
                  size="unset"
                  className="call-transfer-device"
                  disabled={call.transferRequesting}
                  onClick={() => void call.requestTransfer(device.id)}
                >
                  <span className="call-transfer-device-icon">
                    <DeviceIcon name={device.name} />
                  </span>
                  <span>
                    <strong>{device.name}</strong>
                    <small>
                      <span className="call-live-dot" /> Çevrimiçi · Aktarıma
                      hazır
                    </small>
                  </span>
                  <ArrowRightLeft size={17} />
                </Button>
              ))}
            </div>
          ) : (
            <div className="call-transfer-empty">
              <Laptop size={28} />
              <strong>Diğer cihazın henüz görünmüyor</strong>
              <p>
                Aynı hesapla giriş yap, bu çalışma alanını aç ve uygulamayı
                ekranda açık tut. Cihazın burada görünecek.
              </p>
            </div>
          )}
          <p className="call-transfer-note">
            Kamera ve ekran paylaşımı yeni cihazda kapalı başlar.
          </p>
        </>
      )}
    </section>
  );
}

export function IncomingCallTransfer({
  call,
  onAccept,
}: {
  call: CallController;
  onAccept: () => void;
}) {
  const transfer = call.transfer;
  if (transfer?.direction !== "incoming" || transfer.phase !== "waiting")
    return null;
  return (
    <Modal title="Görüşmeyi bu cihaza al" onClose={call.cancelTransfer}>
      <div className="call-transfer-incoming">
        <span className="call-transfer-hero">
          <ArrowRightLeft size={30} />
        </span>
        <h3>{transfer.details.channelName}</h3>
        <p>
          <strong>{transfer.details.sourceDevice}</strong> cihazındaki görüşmene
          burada devam et.
        </p>
        <ul>
          <li>
            <Check size={16} /> Bağlantı kurulana kadar önceki cihazda devam
            edersin.
          </li>
          <li>
            <Check size={16} /> Mikrofon izni istenebilir; sessiz durumun
            korunur.
          </li>
          <li>
            <Check size={16} /> Kamera ve ekran paylaşımı kapalı başlar.
          </li>
        </ul>
        <TransferTime expiresAt={transfer.details.expiresAt} />
        <div className="call-transfer-incoming-actions">
          <Button
            variant="unstyled"
            size="unset"
            className="secondary-button"
            onClick={call.cancelTransfer}
          >
            Şimdi değil
          </Button>
          <Button
            variant="unstyled"
            size="unset"
            className="primary-button"
            onClick={onAccept}
          >
            <ArrowRightLeft size={17} /> Bu cihazda devam et
          </Button>
        </div>
      </div>
    </Modal>
  );
}

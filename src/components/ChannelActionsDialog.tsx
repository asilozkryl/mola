import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Hash, Volume2 } from "lucide-react";
import type { Channel } from "../../shared/types";
import { api } from "../lib/api";
import { Modal, Spinner } from "./ui";
import "./channel-actions.css";

export type ChannelActionMode = "edit" | "archive" | "delete";

interface ChannelActionsDialogProps {
  channel: Channel;
  mode: ChannelActionMode;
  workspaceId: string;
  userId: string;
  onClose: () => void;
  onChanged: (channel: Channel) => void;
  onDeleted: (channelId: string) => void;
}

export default function ChannelActionsDialog(props: ChannelActionsDialogProps) {
  return (
    <ChannelActionForm
      key={`${props.workspaceId}:${props.userId}:${props.channel.id}:${props.mode}`}
      {...props}
    />
  );
}

function ChannelActionForm({
  channel,
  mode,
  workspaceId,
  userId,
  onClose,
  onChanged,
  onDeleted,
}: ChannelActionsDialogProps) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [confirmName, setConfirmName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const operation = useRef(false);
  const alive = useRef(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const restoring = Boolean(channel.archived);
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const unchanged =
    trimmedName === channel.name && trimmedDescription === channel.description;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const close = () => {
    if (!operation.current) onClose();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (operation.current) return;
    if (mode === "delete" && confirmName !== channel.name) return;
    if (mode === "edit") {
      const validation =
        trimmedName.length < 2
          ? "Kanal adı en az 2 karakter olmalı."
          : !/^[\p{L}\p{N}\s_-]+$/u.test(trimmedName)
            ? "Kanal adında harf, sayı, boşluk, tire ve alt çizgi kullanabilirsin."
            : "";
      setNameError(validation);
      if (validation) {
        nameInput.current?.focus();
        return;
      }
      if (unchanged) return;
    }
    operation.current = true;
    setPending(true);
    setError("");
    const changes =
      mode === "edit"
        ? { name: trimmedName, description: trimmedDescription }
        : { archived: !restoring };
    try {
      await api(`/admin/workspace/channels/${channel.id}`, {
        method: mode === "delete" ? "DELETE" : "PATCH",
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
        body: JSON.stringify(mode === "delete" ? { confirmName } : changes),
      });
      if (!alive.current) return;
      if (mode === "delete") onDeleted(channel.id);
      else onChanged({ ...channel, ...changes });
      onClose();
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "İşlem tamamlanamadı. Tekrar deneyebilirsin.",
        );
    } finally {
      operation.current = false;
      if (alive.current) setPending(false);
    }
  }

  const title =
    mode === "edit"
      ? "Kanalı düzenle"
      : mode === "delete"
        ? "Kanalı sil"
        : restoring
          ? "Kanalı arşivden çıkar"
          : "Kanalı arşivle";
  const action =
    mode === "edit"
      ? "Değişiklikleri kaydet"
      : mode === "delete"
        ? "Kanalı kalıcı olarak sil"
        : title;

  return (
    <Modal title={title} onClose={close}>
      <form
        className="channel-action-form"
        onSubmit={submit}
        aria-busy={pending}
      >
        <div className="channel-action-summary">
          {channel.kind === "voice" ? (
            <Volume2 size={18} aria-hidden="true" />
          ) : (
            <Hash size={18} aria-hidden="true" />
          )}
          <strong>{channel.name}</strong>
          {channel.archived && <span>Arşivde</span>}
        </div>

        {mode === "edit" && (
          <>
            <p className="channel-action-note">
              Kanalın adını ve ne için kullanıldığını ekibin için netleştir.
            </p>
            <label htmlFor={`${id}-name`}>Kanal adı</label>
            <input
              id={`${id}-name`}
              ref={nameInput}
              data-autofocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError("");
              }}
              required
              minLength={2}
              maxLength={40}
              disabled={pending}
              autoComplete="off"
              aria-invalid={Boolean(nameError)}
              aria-describedby={`${id}-name-hint${nameError ? ` ${id}-name-error` : ""}`}
            />
            <p id={`${id}-name-hint`} className="channel-action-hint">
              2–40 karakter. Harf, sayı, boşluk, tire ve alt çizgi
              kullanabilirsin.
            </p>
            {nameError && (
              <p id={`${id}-name-error`} className="form-error" role="alert">
                {nameError}
              </p>
            )}
            <label htmlFor={`${id}-description`}>
              Açıklama{" "}
              <span className="channel-action-optional">(isteğe bağlı)</span>
            </label>
            <textarea
              id={`${id}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Bu kanalda neler paylaşılır?"
              disabled={pending}
              aria-describedby={`${id}-description-count`}
            />
            <p id={`${id}-description-count`} className="channel-action-count">
              {description.length}/300
            </p>
          </>
        )}

        {mode === "archive" && (
          <div className="channel-action-explanation">
            {restoring ? (
              <ArchiveRestore size={20} aria-hidden="true" />
            ) : (
              <Archive size={20} aria-hidden="true" />
            )}
            <div>
              <p>
                {restoring
                  ? "Kanal yeniden aktif kanallar arasında görünecek. Ekip mesajlaşmaya ve görüşmelere devam edebilecek."
                  : "Kanal aktif listeden kaldırılacak. Yeni mesajlar ve görüşmeler durdurulacak; devam eden görüşme kapanacak."}
              </p>
              <p>
                {restoring
                  ? "Önceki mesajlar, dosyalar ve erişim ayarları korunur."
                  : "Mesajlar ve dosyalar korunur. Kanalı istediğin zaman arşivden çıkarabilirsin."}
              </p>
            </div>
          </div>
        )}

        {mode === "delete" && (
          <>
            <div className="channel-action-warning">
              <strong>Bu işlem geri alınamaz.</strong>
              <p>
                Kanaldaki tüm mesajlar, yanıtlar ve paylaşılan dosyalar kalıcı
                olarak silinecek. Devam eden görüşme kapanacak.
              </p>
              <p>Geçmişi saklamak istiyorsan kanalı arşivleyebilirsin.</p>
            </div>
            <p id={`${id}-confirm-hint`} className="channel-action-note">
              Onaylamak için{" "}
              <strong className="channel-action-confirm-name">
                {channel.name}
              </strong>{" "}
              adını aşağıya aynen yaz.
            </p>
            <label htmlFor={`${id}-confirm`}>Kanal adını doğrula</label>
            <input
              id={`${id}-confirm`}
              data-autofocus
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              aria-describedby={`${id}-confirm-hint`}
            />
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="channel-action-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={close}
            data-autofocus={mode === "archive" ? true : undefined}
          >
            Vazgeç
          </button>
          <button
            type="submit"
            className={mode === "delete" ? "danger-button" : "primary-button"}
            disabled={
              pending ||
              (mode === "delete" && confirmName !== channel.name) ||
              (mode === "edit" && unchanged)
            }
          >
            {pending ? (
              <Spinner
                label={mode === "delete" ? "Siliniyor" : "Kaydediliyor"}
              />
            ) : (
              action
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

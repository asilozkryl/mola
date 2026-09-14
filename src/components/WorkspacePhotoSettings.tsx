import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Camera, Check, Trash2, X } from "lucide-react";
import type { Workspace } from "../../shared/types";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Spinner } from "./ui";
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import "./workspace-photo-settings.css";

const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export function WorkspacePhotoSettings({
  workspace,
  userId,
  canEdit,
  onUpdated,
}: {
  workspace: Workspace;
  userId: string;
  canEdit: boolean;
  onUpdated: (workspace: Workspace) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const operation = useRef(false);
  const updatedRef = useRef(onUpdated);
  updatedRef.current = onUpdated;
  const [avatarUrl, setAvatarUrl] = useState(workspace.avatarUrl);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [previewStatus, setPreviewStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setAvatarUrl(workspace.avatarUrl);
  }, [workspace.avatarUrl]);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || operation.current || !canEdit) return;
    setError("");
    setNotice("");
    if (!supportedTypes.has(file.type)) {
      setError("PNG, JPEG veya WebP biçiminde bir fotoğraf seç.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Fotoğraf en fazla 5 MB olabilir.");
      return;
    }
    if (!file.size) {
      setError("Bu dosya boş. Başka bir fotoğraf seç.");
      return;
    }
    setPreviewStatus("loading");
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  function cancelPhoto() {
    if (operation.current) return;
    setPhoto(null);
    setError("");
    setNotice("");
    pickerRef.current?.focus();
  }

  async function savePhoto(remove = false) {
    if (
      !canEdit ||
      operation.current ||
      (!remove && (!photo || previewStatus !== "ready"))
    )
      return;
    operation.current = true;
    setBusy(remove ? "remove" : "upload");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      if (!remove && photo) form.append("file", photo.file);
      const saved = await api<Workspace>(`/workspaces/${workspace.id}/avatar`, {
        method: remove ? "DELETE" : "POST",
        headers: { "X-Workspace-Id": workspace.id, "X-User-Id": userId },
        ...(!remove ? { body: form } : {}),
      });
      if (mounted.current) {
        setAvatarUrl(saved.avatarUrl);
        setPhoto(null);
        setNotice(
          remove
            ? "Çalışma alanı fotoğrafı kaldırıldı."
            : "Çalışma alanı fotoğrafı güncellendi.",
        );
        requestAnimationFrame(() => {
          if (mounted.current) pickerRef.current?.focus();
        });
      }
      updatedRef.current(saved);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <section
      className="adm-settings-section workspace-photo-settings"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>Çalışma alanı fotoğrafı</h2>
      <p id={`${id}-guidance`}>
        Ekibini tanımayı kolaylaştıran bir fotoğraf veya logo ekle. PNG, JPEG
        veya WebP · En fazla 5 MB.
      </p>
      <div className="workspace-photo-editor">
        <div className="workspace-photo-preview">
          {photo && previewStatus !== "error" ? (
            <img
              key={photo.url}
              className="workspace-photo-image"
              src={photo.url}
              alt="Yeni çalışma alanı fotoğrafının önizlemesi"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth * image.naturalHeight > 25_000_000) {
                  setPreviewStatus("error");
                  setError(
                    "Fotoğraf en fazla 25 megapiksel olabilir. Daha küçük bir fotoğraf seç.",
                  );
                } else setPreviewStatus("ready");
              }}
              onError={() => {
                setPreviewStatus("error");
                setError("Bu fotoğraf açılamadı. Başka bir fotoğraf seç.");
              }}
            />
          ) : (
            <WorkspaceAvatar
              workspace={{ ...workspace, avatarUrl }}
              size="large"
            />
          )}
          {photo && (
            <span className="workspace-photo-preview-badge">Önizleme</span>
          )}
        </div>
        {canEdit ? (
          <div className="workspace-photo-controls">
            <div className="workspace-photo-actions">
              <Button
                ref={pickerRef}
                type="button"
                variant="outline"
                size="lg"
                disabled={Boolean(busy)}
                onClick={() => inputRef.current?.click()}
              >
                <Camera size={16} />{" "}
                {avatarUrl || photo ? "Fotoğrafı değiştir" : "Fotoğraf ekle"}
              </Button>
              {avatarUrl && !photo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  disabled={Boolean(busy)}
                  onClick={() => void savePhoto(true)}
                >
                  {busy === "remove" ? <Spinner /> : <Trash2 size={16} />}
                  {busy === "remove" ? "Kaldırılıyor…" : "Fotoğrafı kaldır"}
                </Button>
              )}
            </div>
            {photo && (
              <>
                <p className="workspace-photo-pending">
                  Fotoğrafı ekibinle paylaşmak için kaydet.
                </p>
                <div className="workspace-photo-actions">
                  <Button
                    type="button"
                    size="lg"
                    disabled={Boolean(busy) || previewStatus !== "ready"}
                    onClick={() => void savePhoto()}
                  >
                    {busy === "upload" ? <Spinner /> : <Check size={16} />}
                    {busy === "upload" ? "Kaydediliyor…" : "Fotoğrafı kaydet"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    disabled={Boolean(busy)}
                    onClick={cancelPhoto}
                  >
                    <X size={16} /> Vazgeç
                  </Button>
                </div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              className="visually-hidden"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Çalışma alanı fotoğrafı seç"
              aria-describedby={`${id}-guidance`}
              tabIndex={-1}
              disabled={Boolean(busy)}
              onChange={choosePhoto}
            />
          </div>
        ) : (
          <p>
            Fotoğrafı çalışma alanının sahibi veya yöneticileri değiştirebilir.
          </p>
        )}
      </div>
      {error && (
        <p className="workspace-photo-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="workspace-photo-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

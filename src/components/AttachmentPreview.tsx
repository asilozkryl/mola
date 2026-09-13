import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, MessageSquare, RotateCw } from "lucide-react";
import type { Attachment } from "../../shared/types";
import { ApiError } from "../lib/api";
import { fileSize, Modal, Spinner } from "./ui";
import PdfPreview from "./PdfPreview";
import "./attachment-preview.css";

export type AttachmentPreviewTarget = {
  file: Attachment;
  channelId: string;
  messageId: string;
  parentId?: string | null;
  workspaceId: string;
  userId: string;
};
export function AttachmentPreview({
  target,
  onClose,
  onOpenMessage,
}: {
  target: AttachmentPreviewTarget;
  onClose: () => void;
  onOpenMessage: () => Promise<void>;
}) {
  const { file, userId, workspaceId } = target;
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.mime);
  const pdf = file.mime === "application/pdf";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    setLoading(true);
    // Fetch through the authorized file route before handing bytes to a viewer.
    fetch(`/api/files/${encodeURIComponent(file.id)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body.error ||
              "Dosya açılamadı. Erişimin kaldırılmış veya dosya silinmiş olabilir.",
          );
        }
        if (image || pdf) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(
            new Blob([blob], { type: file.mime }),
          );
          setUrl(objectUrl);
        } else {
          await response.body?.cancel();
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.mime, workspaceId, userId, image, pdf, retry]);
  async function openMessage() {
    setOpening(true);
    setError("");
    try {
      await onOpenMessage();
    } catch (reason) {
      if (alive.current) {
        setError((reason as Error).message);
        if (
          reason instanceof ApiError &&
          [401, 403, 404].includes(reason.status)
        ) {
          if (url) URL.revokeObjectURL(url);
          setUrl("");
        }
      }
    } finally {
      if (alive.current) setOpening(false);
    }
  }
  return (
    <Modal title="Dosya önizlemesi" onClose={onClose} wide>
      <div className="attachment-preview">
        <div className="attachment-preview-meta">
          <FileText size={21} aria-hidden="true" />
          <div>
            <h3>{file.name}</h3>
            <span>
              {fileSize(file.size)} ·{" "}
              {pdf ? "PDF belgesi" : image ? "Görsel" : "Dosya"}
            </span>
          </div>
        </div>
        {error && (
          <div className="attachment-preview-error" role="alert">
            <p>{error}</p>
            <Button
              variant="outline"
              size="unset"
              type="submit"
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RotateCw size={15} />
              Tekrar dene
            </Button>
          </div>
        )}
        <div
          className={`attachment-preview-stage${pdf ? " attachment-preview-pdf" : ""}`}
          aria-busy={loading}
        >
          {loading ? (
            <Spinner label="Dosya yükleniyor" />
          ) : url && image ? (
            <img
              src={url}
              alt={file.name}
              onError={() => {
                setUrl("");
                setError(
                  "Bu görsel görüntülenemedi. Dosyayı indirerek açabilirsin.",
                );
              }}
            />
          ) : url && pdf ? (
            <PdfPreview url={url} title={file.name} />
          ) : (
            !error && (
              <div className="attachment-preview-fallback">
                <FileText size={38} aria-hidden="true" />
                <p>Bu dosya türü için önizleme yok.</p>
                <span>Dosyayı indirip cihazında açabilirsin.</span>
              </div>
            )
          )}
        </div>
        <div className="attachment-preview-actions">
          <Button
            variant="outline"
            size="unset"
            type="submit"
            className="secondary-button"
            disabled={opening}
            onClick={() => void openMessage()}
          >
            <MessageSquare size={16} />
            {opening ? "Mesaj açılıyor…" : "Mesaja git"}
          </Button>
          <a
            className="primary-button"
            href={`/api/files/${encodeURIComponent(file.id)}`}
            download={file.name}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} />
            Dosyayı indir
          </a>
        </div>
      </div>
    </Modal>
  );
}

import { AlertCircle, RotateCw } from "lucide-react";
import "./collection-state.css";

export function CollectionError({
  kind,
  message,
  onRetry,
}: {
  kind: "files" | "pins";
  message: string;
  onRetry: () => void;
}) {
  const title =
    kind === "files"
      ? "Dosyalar yüklenemedi"
      : "Sabitlenen mesajlar yüklenemedi";
  return (
    <section className="collection-error" role="alert" aria-label={title}>
      <AlertCircle size={21} aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        <button type="button" className="secondary-button" onClick={onRetry}>
          <RotateCw size={15} aria-hidden="true" /> Yeniden dene
        </button>
      </div>
    </section>
  );
}

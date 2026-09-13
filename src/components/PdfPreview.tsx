import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Spinner } from "./ui";
import "./pdf-preview.css";

type Props = { url: string; title: string };

function documentError(reason: unknown) {
  const name = reason instanceof Error ? reason.name : "";
  if (name === "PasswordException")
    return "Bu PDF parola korumalı. Dosyayı indirip parolanla açabilirsin.";
  if (name === "InvalidPDFException")
    return "Bu dosya geçerli bir PDF olarak açılamadı. Dosyayı indirip kontrol edebilirsin.";
  return "PDF yüklenemedi. Yeniden deneyebilir veya dosyayı indirebilirsin.";
}

/** The caller owns the authorized blob URL and revokes it when the preview closes. */
export default function PdfPreview(props: Props) {
  return <PdfDocument key={props.url} {...props} />;
}

function PdfDocument({ url, title }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | null = null;
    setDocument(null);
    setError("");
    void (async () => {
      try {
        // Import failures are handled like document failures and can be retried.
        const pdfjs = await import("pdfjs-dist");
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        task = pdfjs.getDocument({
          url,
          useSystemFonts: true,
          stopAtErrors: true,
        });
        const loaded = await task.promise;
        if (disposed) return;
        setPageNumber((current) =>
          Math.max(1, Math.min(current, loaded.numPages)),
        );
        setDocument(loaded);
      } catch (reason) {
        if (!disposed) setError(documentError(reason));
      }
    })();
    return () => {
      disposed = true;
      // Includes pending network work, page resources and the dedicated worker.
      void task?.destroy().catch(() => {});
    };
  }, [url, retry]);
  return (
    <section className="pdf-preview" aria-label={`${title} PDF önizlemesi`}>
      <div className="pdf-preview-toolbar" aria-label="PDF sayfaları">
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          aria-label="Önceki PDF sayfası"
          title="Önceki sayfa"
          disabled={!document || pageNumber <= 1}
          onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          <span>Önceki</span>
        </Button>
        <span
          className="pdf-preview-page-count"
          role="status"
          aria-live="polite"
        >
          {document ? `${pageNumber} / ${document.numPages}` : "PDF"}
        </span>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          aria-label="Sonraki PDF sayfası"
          title="Sonraki sayfa"
          disabled={!document || pageNumber >= document.numPages}
          onClick={() =>
            setPageNumber((current) =>
              Math.min(document?.numPages || current, current + 1),
            )
          }
        >
          <span>Sonraki</span>
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      </div>
      {error ? (
        <PdfError
          message={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : document ? (
        <PdfPage
          key={`${retry}:${pageNumber}`}
          document={document}
          pageNumber={pageNumber}
          title={title}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : (
        <div className="pdf-preview-loading">
          <Spinner label="PDF yükleniyor" />
        </div>
      )}
    </section>
  );
}

function PdfError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="pdf-preview-error" role="alert">
      <p>{message}</p>
      <Button
        variant="outline"
        size="unset"
        type="button"
        className="secondary-button"
        aria-label="PDF önizlemesini yeniden dene"
        onClick={onRetry}
      >
        <RotateCw size={15} aria-hidden="true" /> Yeniden dene
      </Button>
    </div>
  );
}

function PdfPage({
  document,
  pageNumber,
  title,
  onRetry,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  title: string;
  onRetry: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () =>
      setWidth(Math.max(1, Math.floor(element.clientWidth - 24)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="pdf-preview-page" ref={viewport}>
      {width > 0 && (
        <PdfCanvas
          key={width}
          document={document}
          pageNumber={pageNumber}
          title={title}
          width={width}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}

function PdfCanvas({
  document,
  pageNumber,
  title,
  width,
  onRetry,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  title: string;
  width: number;
  onRetry: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderGeneration = useRef(0);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const generation = ++renderGeneration.current;
    let disposed = false;
    const isCurrent = () =>
      !disposed && renderGeneration.current === generation;
    let page: PDFPageProxy | null = null;
    let rendering: RenderTask | null = null;
    let reading: Promise<void> | null = null;
    void (async () => {
      try {
        page = await document.getPage(pageNumber);
        if (!isCurrent()) {
          if (renderGeneration.current === generation) page.cleanup();
          return;
        }
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(width / original.width, 2400 / original.height);
        const fitted = page.getViewport({ scale });
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(8_000_000 / (fitted.width * fitted.height)),
        );
        element.width = Math.max(1, Math.floor(fitted.width * outputScale));
        element.height = Math.max(1, Math.floor(fitted.height * outputScale));
        element.style.width = `${fitted.width}px`;
        element.style.height = `${fitted.height}px`;
        reading = page
          .getTextContent()
          .then((content) => {
            if (!isCurrent()) return;
            setText(
              content.items
                .map((item) =>
                  "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
                )
                .join("")
                .trim(),
            );
          })
          .catch(() => {
            if (isCurrent()) setTextError(true);
          });
        rendering = page.render({
          canvas: element,
          viewport: fitted,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
          background: "#fff",
        });
        await rendering.promise;
        if (isCurrent()) setRendered(true);
      } catch (reason) {
        if (
          isCurrent() &&
          !(
            reason instanceof Error &&
            reason.name === "RenderingCancelledException"
          )
        )
          setError(
            "Bu PDF sayfası görüntülenemedi. Yeniden deneyebilir veya dosyayı indirebilirsin.",
          );
      }
    })();
    return () => {
      disposed = true;
      rendering?.cancel();
      // StrictMode can set up another effect on this same canvas before cleanup settles.
      void Promise.allSettled([rendering?.promise, reading]).then(() => {
        if (renderGeneration.current !== generation) return;
        try {
          page?.cleanup();
        } catch {
          /* The document may already be destroyed. */
        }
        element.width = 0;
        element.height = 0;
      });
    };
  }, [document, pageNumber, width]);
  return (
    <>
      <div
        className="pdf-preview-viewport"
        role="region"
        aria-label={`${pageNumber}. PDF sayfası`}
        tabIndex={0}
        aria-busy={!rendered && !error}
      >
        {error ? (
          <PdfError message={error} onRetry={onRetry} />
        ) : (
          <div className="pdf-preview-sheet">
            {!rendered && (
              <div className="pdf-preview-rendering">
                <Spinner label="PDF sayfası hazırlanıyor" />
              </div>
            )}
            <canvas
              ref={canvas}
              role="img"
              aria-label={`${title}, ${pageNumber}. sayfa`}
              data-pdf-rendered={rendered ? "true" : "false"}
              style={{ visibility: rendered ? "visible" : "hidden" }}
            />
          </div>
        )}
      </div>
      <details className="pdf-preview-text">
        <summary>Sayfa metnini göster</summary>
        <div role="region" aria-label="PDF sayfa metni" tabIndex={0}>
          {textError || (error && text === null)
            ? "Bu sayfanın metni okunamadı. Görsel önizlemeyi kullanabilir veya dosyayı indirebilirsin."
            : text === null
              ? "Sayfa metni hazırlanıyor…"
              : text || "Bu sayfada seçilebilir metin yok."}
        </div>
      </details>
    </>
  );
}

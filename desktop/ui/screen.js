"use strict";

const sourcesContainer = document.getElementById("sources");
const sourcesArea = document.querySelector(".source-area");
const sourcesStatus = document.getElementById("sources-status");
const sourcesError = document.getElementById("sources-error");
const cancelButton = document.getElementById("cancel");
let selecting = false;

function showError(message) {
  sourcesError.textContent = message || "";
  sourcesError.hidden = !message;
}

async function selectSource(id) {
  if (selecting) return;
  selecting = true;
  sourcesArea.setAttribute("aria-busy", "true");
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  showError("");

  try {
    await window.molaDesktop.selectSource(id);
    sourcesStatus.textContent = id === null ? "Paylaşım iptal ediliyor…" : "Ekran paylaşımı başlatılıyor…";
  } catch {
    showError("Seçim tamamlanamadı. Yeniden dene veya bu pencereyi kapat.");
    selecting = false;
    sourcesArea.setAttribute("aria-busy", "false");
    document.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    cancelButton.focus();
  }
}

cancelButton.addEventListener("click", () => void selectSource(null));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void selectSource(null);
  }
});

function createSourceButton(source) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source-button";
  button.setAttribute("aria-label", `${source.name} — paylaş`);

  const preview = document.createElement("div");
  preview.className = "source-preview";
  if (typeof source.thumbnail === "string" && source.thumbnail.startsWith("data:image/")) {
    const image = document.createElement("img");
    image.src = source.thumbnail;
    image.alt = "";
    image.addEventListener("error", () => {
      image.remove();
      preview.textContent = "Önizleme kullanılamıyor";
    }, { once: true });
    preview.append(image);
  } else {
    preview.textContent = "Önizleme kullanılamıyor";
  }

  const label = document.createElement("span");
  label.className = "source-name";
  label.textContent = source.name;
  label.title = source.name;
  const action = document.createElement("span");
  action.className = "source-action";
  action.textContent = "Paylaş";
  button.append(preview, label, action);
  button.addEventListener("click", () => void selectSource(source.id));
  return button;
}

async function initialize() {
  try {
    if (!window.molaDesktop?.getSources || !window.molaDesktop?.selectSource) {
      throw new Error("Ekran paylaşımı başlatılamadı. Bu pencereyi kapatıp yeniden dene.");
    }
    const result = await window.molaDesktop.getSources();
    if (selecting) return;
    if (result?.error) throw new Error(result.error);
    const sources = Array.isArray(result?.sources)
      ? result.sources.filter((source) => typeof source?.id === "string" && typeof source?.name === "string")
      : [];
    if (sources.length === 0) {
      throw new Error("Paylaşılabilir bir ekran veya pencere bulunamadı. Sistem ayarlarındaki ekran kaydı iznini kontrol edip yeniden dene.");
    }
    for (const source of sources) sourcesContainer.append(createSourceButton(source));
    sourcesStatus.textContent = "";
    sourcesContainer.querySelector("button")?.focus();
  } catch (error) {
    if (selecting) return;
    sourcesStatus.textContent = "";
    showError(error instanceof Error ? error.message : "Ekranlar listelenemedi. Yeniden dene.");
    cancelButton.focus();
  } finally {
    if (!selecting) sourcesArea.setAttribute("aria-busy", "false");
  }
}

void initialize();

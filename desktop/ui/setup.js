"use strict";

const form = document.getElementById("connect-form");
const serverInput = document.getElementById("server-url");
const connectButton = document.getElementById("connect");
const connectionError = document.getElementById("connection-error");
const connectionStatus = document.getElementById("connection-status");
let connecting = false;

function setBusy(busy) {
  connecting = busy;
  serverInput.disabled = busy;
  connectButton.disabled = busy;
  form.setAttribute("aria-busy", String(busy));
}

function showError(message) {
  connectionError.textContent = message || "";
  connectionError.hidden = !message;
  serverInput.setAttribute("aria-invalid", String(Boolean(message)));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (connecting) return;

  serverInput.value = serverInput.value.trim();
  if (!form.reportValidity()) return;

  showError("");
  setBusy(true);
  connectionStatus.textContent = "Sunucuya bağlanılıyor…";

  try {
    const result = await window.molaDesktop.connect(serverInput.value);
    if (!result?.ok) {
      throw new Error(result?.error || "Sunucuya bağlanılamadı. Adresi kontrol edip yeniden dene.");
    }
    connectionStatus.textContent = "Mola açılıyor…";
  } catch (error) {
    connectionStatus.textContent = "";
    showError(error instanceof Error ? error.message : "Bağlantı kurulamadı. Yeniden dene.");
    setBusy(false);
    serverInput.focus();
  }
});

serverInput.addEventListener("input", () => showError(""));

async function initialize() {
  if (!window.molaDesktop?.getState || !window.molaDesktop?.connect) {
    connectionStatus.textContent = "";
    showError("Masaüstü bağlantısı başlatılamadı. Uygulamayı yeniden açmayı dene.");
    return;
  }

  try {
    const state = await window.molaDesktop.getState();
    serverInput.value = typeof state?.serverUrl === "string" ? state.serverUrl : "";
    showError(typeof state?.error === "string" ? state.error : "");
  } catch {
    showError("Kaydedilen sunucu adresi okunamadı. Adresi yeniden girerek bağlanabilirsin.");
  } finally {
    connectionStatus.textContent = "";
    setBusy(false);
    serverInput.focus();
  }
}

void initialize();

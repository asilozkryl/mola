import { Button } from "@/components/ui/button";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import App from "./App";
import "./tailwind.css";
import "./styles.css";
import "./workspace-polish.css";
import "./design-system.css";
import { initializePwa } from "./lib/pwa";
import { initializeAppearance } from "./lib/appearance";
import { TooltipProvider } from "./components/ui/tooltip";

initializeAppearance();
initializePwa();

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal-state">
        <h1>Bir şeyler yolunda gitmedi.</h1>
        <p>Sayfayı yenileyerek çalışma alanına dönebilirsin.</p>
        <Button
          variant="default"
          size="unset"
          type="submit"
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          Sayfayı yenile
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TooltipProvider delay={450}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

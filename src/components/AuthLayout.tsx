import type { ReactNode } from "react";
import { ArrowRight, AudioLines, MessageCircle, MonitorUp } from "lucide-react";
import { Logo } from "./ui";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="auth-story-body">
          <span className="auth-pill">
            <span /> Birlikte çalışmanın daha doğal hâli
          </span>
          <h1>
            İyi işler,
            <br />
            iyi bir sohbetle
            <br />
            başlar.
          </h1>
          <p>
            Ekibin, fikirlerin ve günün küçük molaları.
            <br />
            Hepsi aynı yerde.
          </p>
          <div className="auth-illustration">
            <div className="floating-chat">
              <span className="illustration-avatar">D</span>
              <div>
                <strong>Deniz</strong>
                <p>Birlikte üzerinden geçelim mi? ✨</p>
              </div>
              <span>şimdi</span>
            </div>
            <div className="floating-call">
              <AudioLines size={26} />
              <div>
                <strong>Tasarım odası</strong>
                <span>Sohbetten birlikte üretmeye.</span>
              </div>
              <span className="round-arrow">
                <ArrowRight size={20} />
              </span>
            </div>
          </div>
          <div className="auth-benefits">
            <span>
              <MessageCircle size={17} /> Düzenli sohbetler
            </span>
            <span>
              <AudioLines size={17} /> Sesli odalar
            </span>
            <span>
              <MonitorUp size={17} /> Ekran paylaşımı
            </span>
          </div>
        </div>
        <small>Biraz iş. Biraz sohbet. Birlikte daha fazlası.</small>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-wrap">{children}</div>
        <span className="auth-footer">
          Mola © {new Date().getFullYear()} · Birlikte, aynı yerde.
          <br />
          <a href="/download" target="_blank" rel="noopener noreferrer">
            Masaüstü uygulamasını indir
          </a>
        </span>
      </section>
    </main>
  );
}

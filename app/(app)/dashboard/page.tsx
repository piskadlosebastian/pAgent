import Link from "next/link";
import { CheckCircle2, FileText, ShieldCheck, Sparkles, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser();
  const [childrenCount, documentsCount, latestDocuments] = await Promise.all([
    prisma.child.count({ where: { userId: user.id } }),
    prisma.document.count({ where: { userId: user.id } }),
    prisma.document.findMany({
      where: { userId: user.id },
      include: { child: true },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);
  const reviewCount = latestDocuments.filter((document) => document.status === "REVIEW").length;

  return (
    <div className="grid">
      <section className="panel hero-panel">
        <div className="page-title">
          <h1>Witaj w pAgent</h1>
          <p>Pracuj spokojnie z dokumentami PPP, bazą dzieci i projektami opinii w jednym bezpiecznym, uporządkowanym miejscu.</p>
          <div className="hero-actions">
            <Link className="button accent" href="/new-opinion">
              <Sparkles size={18} aria-hidden />
              Utwórz nową opinię
            </Link>
            <Link className="button secondary" href="/documents">
              <FileText size={18} aria-hidden />
              Przejdź do dokumentów
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-3">
        <article className="card stat">
          <span className="stat-icon"><Users size={24} aria-hidden /></span>
          <div>
            <strong>{childrenCount}</strong>
            <span className="muted">dzieci w bazie</span>
          </div>
          <p className="muted">Podstawowe dane podopiecznych i historia dokumentów.</p>
        </article>
        <article className="card stat">
          <span className="stat-icon"><FileText size={24} aria-hidden /></span>
          <div>
            <strong>{documentsCount}</strong>
            <span className="muted">utworzonych dokumentów</span>
          </div>
          <p className="muted">Robocze, do weryfikacji, zatwierdzone i archiwalne.</p>
        </article>
        <article className="card stat">
          <span className="stat-icon"><CheckCircle2 size={24} aria-hidden /></span>
          <div>
            <strong>{reviewCount}</strong>
            <span className="muted">ostatnich do weryfikacji</span>
          </div>
          <p className="muted">Dokument końcowy zawsze zatwierdza uprawniony specjalista.</p>
        </article>
      </section>

      <section className="panel table-card">
        <div className="toolbar">
          <h2>Ostatnie dokumenty</h2>
          <Link href="/documents" className="button secondary">
            Wszystkie dokumenty
          </Link>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Tytul</th>
              <th>Dziecko</th>
              <th>Status</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {latestDocuments.map((document) => (
              <tr key={document.id}>
                <td>{document.title}</td>
                <td>
                  {document.child.firstName} {document.child.lastName}
                </td>
                <td>
                  <span className={`badge status-${document.status}`}>{document.status}</span>
                </td>
                <td>{document.createdAt.toLocaleDateString("pl-PL")}</td>
              </tr>
            ))}
            {!latestDocuments.length ? (
              <tr>
                <td colSpan={4} className="muted">
                  Brak dokumentów. Zacznij od utworzenia pierwszej opinii.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

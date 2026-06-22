# pAgent

pAgent to aplikacja webowa do przygotowywania projektów opinii do Poradni Psychologiczno-Pedagogicznej. Aplikacja nie jest ogólnym chatbotem i nie diagnozuje dziecka samodzielnie.

## Stack

- Next.js App Router + React
- NextAuth credentials login
- PostgreSQL + Prisma 7
- Lokalny storage plików w `storage/uploads`
- Eksport DOCX
- Wbudowany wybór darmowych agentów opinii

## Uruchomienie lokalne

1. Skopiuj i dostosuj `.env.example` do `.env`.
2. Uruchom bazę:

```bash
docker compose up -d
```

3. Wykonaj migrację i seed administratora:

```bash
npm run prisma:migrate
npm run prisma:seed
```

4. Uruchom aplikację:

```bash
npm run dev
```

Domyślny lokalny adres:

```text
http://localhost:3000
```

## Wdrożenie

Instrukcja publikacji na GitHub i uruchomienia na VPS znajduje się w [DEPLOYMENT.md](./DEPLOYMENT.md).

## Bezpieczeństwo

- Hasła są hashowane przez bcrypt.
- Trasy aplikacji chroni NextAuth middleware.
- Endpointy sprawdzają właściciela danych przez `userId`.
- Pliki są przechowywane lokalnie i nie mają publicznych linków.
- W ustawieniach wybiera się tylko agenta opinii; szczegóły techniczne darmowych agentów są zaszyte w kodzie.
- Agent `pAgent Lokalny` działa bez internetu, konta i klucza API.
- Agenci Ollama są darmowi i lokalni, ale wymagają uruchomionego Ollama na VPS oraz pobranego modelu, np. `ollama pull llama3.1`.

# Wdrożenie pAgent na GitHub i VPS

## 1. Przygotowanie GitHub

Utwórz puste repozytorium na GitHubie, np. `pAgent`.

W katalogu projektu uruchom:

```bash
git init
git add .
git commit -m "Initial pAgent application"
git branch -M main
git remote add origin https://github.com/TWOJ_LOGIN/pAgent.git
git push -u origin main
```

Nie dodawaj do repo plików `.env` ani `.env.production`. Są ignorowane przez `.gitignore`.

## 2. Przygotowanie VPS

Na VPS zainstaluj:

- Docker
- Docker Compose
- Git

Sklonuj repozytorium:

```bash
git clone https://github.com/TWOJ_LOGIN/pAgent.git
cd pAgent
```

Utwórz plik środowiskowy:

```bash
cp .env.production.example .env.production
nano .env.production
```

Ustaw mocne wartości:

- `POSTGRES_PASSWORD`
- `DATABASE_URL` z tym samym hasłem
- `NEXTAUTH_URL`, np. `https://twoja-domena.pl`
- `NEXTAUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Sekret możesz wygenerować poleceniem:

```bash
openssl rand -base64 32
```

## 3. Start aplikacji

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Seed konta administratora wykonaj po pierwszym starcie:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app npm run prisma:seed
```

Aplikacja będzie dostępna na porcie `3000`.

## 4. Reverse proxy i HTTPS

Najprościej wystawić aplikację za Caddy albo Nginx.

Przykład Caddy:

```caddyfile
twoja-domena.pl {
  reverse_proxy 127.0.0.1:3000
}
```

Po ustawieniu domeny pamiętaj, aby `NEXTAUTH_URL` w `.env.production` było dokładnie adresem produkcyjnym, np. `https://twoja-domena.pl`.

## 5. Aktualizacja aplikacji na VPS

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Migracje Prisma wykonują się automatycznie przy starcie kontenera aplikacji.

## 6. Backup danych

Najważniejsze dane:

- baza PostgreSQL w wolumenie `pagent-postgres-data`,
- załączniki w wolumenie `pagent-uploads`.

Przed większymi zmianami wykonuj backup bazy i uploadów.

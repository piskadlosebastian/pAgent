# Wdrożenie pAgent na VPS

Docelowy adres aplikacji: `https://pagent.nexurio.pl`.

## 1. DNS

W panelu DNS domeny `nexurio.pl` dodaj rekord:

```text
Typ: A
Nazwa/Host: pagent
Wartość: IP_TWOJEGO_VPS
TTL: 300 albo domyślne
```

Jeśli używasz IPv6, możesz dodać także rekord `AAAA`.

## 2. Przygotowanie VPS

Na VPS zainstaluj Docker, Docker Compose i Git.

Sklonuj repozytorium:

```bash
git clone https://github.com/piskadlosebastian/pAgent.git
cd pAgent
```

Utwórz plik środowiskowy:

```bash
cp .env.production.example .env.production
nano .env.production
```

W `.env.production` ustaw:

- `APP_DOMAIN="pagent.nexurio.pl"`
- `NEXTAUTH_URL="https://pagent.nexurio.pl"`
- mocne `POSTGRES_PASSWORD`
- `DATABASE_URL` z tym samym hasłem bazy
- mocne `NEXTAUTH_SECRET`
- `ADMIN_EMAIL`
- mocne `ADMIN_PASSWORD`

Sekret wygenerujesz tak:

```bash
openssl rand -base64 32
```

## 3. Firewall

Otwórz porty:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow OpenSSH
sudo ufw enable
```

Jeżeli VPS ma inny firewall w panelu dostawcy, tam też otwórz `80` i `443`.

## 4. Start aplikacji

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Seed konta administratora po pierwszym starcie:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app npm run prisma:seed
```

Caddy automatycznie pobierze certyfikat HTTPS dla `pagent.nexurio.pl`, jeśli DNS wskazuje na VPS i porty `80/443` są otwarte.

## 5. Aktualizacja aplikacji

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Migracje Prisma wykonują się automatycznie przy starcie kontenera aplikacji.

## 6. Backup danych

Najważniejsze dane:

- baza PostgreSQL w wolumenie `pagent-postgres-data`,
- załączniki w wolumenie `pagent-uploads`,
- certyfikaty Caddy w wolumenach `caddy-data` i `caddy-config`.

Przed większymi zmianami wykonuj backup bazy i uploadów.

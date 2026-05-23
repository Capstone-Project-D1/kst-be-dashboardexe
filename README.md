# KST Backend Dashboard Executive

Backend production-ready untuk `kst-fe-dashboardexe`, dibuat dengan Node.js, Express.js, TypeScript, PostgreSQL, Prisma, Zod, JWT, refresh token HTTP-only cookie, dan RBAC terpusat.

## Quick Start

```bash
cd kst-be-dashboardexe
npm install
cp .env.example .env
docker compose up -d
npx prisma migrate dev
npx prisma db seed
npm run dev
```

API berjalan di `http://localhost:8000`. Arahkan frontend ke:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Akun Seed

| Role | Username | Email | Password |
| --- | --- | --- | --- |
| super_admin | `superadmin` | `superadmin@kst-ub.ac.id` | `SuperAdmin123!` |
| manajemen | `manajemen` | `manajemen@kst-ub.ac.id` | `Manajemen123!` |
| operator Ngijo | `operator_ngijo` | `operator.ngijo@kst-ub.ac.id` | `Operator123!` |
| operator Cangar | `operator_cangar` | `operator.cangar@kst-ub.ac.id` | `Operator123!` |
| operator Jatikerto | `operator_jatikerto` | `operator.jatikerto@kst-ub.ac.id` | `Operator123!` |

## RBAC

Role final:

- `super_admin`: akses penuh, semua KST, user management, approval registrasi, approval perubahan data.
- `manajemen`: view only, bisa baca dashboard/data dan download report.
- `operator`: hanya satu KST, bisa baca dan submit perubahan. Perubahan masuk `data_change_requests` status `pending` sampai diverifikasi `super_admin`.

User baru dari `/auth/register` selalu `pending_approval`. Jika role yang diajukan `operator`, `requestedKstIdentifier` wajib.

## Endpoint Utama

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/select-role`
- `GET/POST/PATCH/DELETE /users`
- `GET /approvals/registrations`
- `POST /approvals/registrations/:id/approve`
- `POST /approvals/registrations/:id/reject`
- `GET /approvals/data-changes`
- `POST /approvals/data-changes/:id/approve`
- `POST /approvals/data-changes/:id/reject`
- `POST /approvals/data-changes/:id/cancel`
- `GET /contract`
- `GET /data/*`
- `POST /query`
- `PUT/POST/PATCH/DELETE /data/*`
- `GET /reports/download?kst=ngijo&report=tracker-inovasi&year=2026&month=Mei&format=csv`

Compatibility endpoints frontend juga tersedia, misalnya:

- `GET /dashboard/summary`
- `GET /dashboard/collaboration`
- `GET /dashboard/research-projects`
- `GET /kst/ngijo/tracker-inovasi`
- `GET /kst/ngijo/keberlanjutan/sensors`
- `GET /kst/cangar/stok-opname`
- `GET /kst/cangar/booklist-atp/reservasi`
- `GET /kst/cangar/booklist-atp/pelanggan`
- `GET /kst/jatikerto/pertanian`
- `GET /kst/jatikerto/peternakan`
- `GET /kst/jatikerto/konservasi`
- `GET /kst/jatikerto/pelayanan-akademik`
- `GET /kst/jatikerto/kemitraan`

Semua response JSON canonical memakai:

```json
{
  "timestamp": "2026-05-23T10:00:00.000Z",
  "response": {}
}
```

Error:

```json
{
  "timestamp": "2026-05-23T10:00:00.000Z",
  "response": null,
  "error": { "code": 403, "message": "Akses ditolak." }
}
```

## Alur Approval

Registrasi:

1. User register dengan `requestedRole`.
2. User dibuat `pending_approval`.
3. `super_admin` melihat `/approvals/registrations`.
4. Approve membuat user `active` dan assign role.

Perubahan data operator:

1. Operator `POST/PATCH/DELETE` ke endpoint modul KST miliknya.
2. Backend membuat `data_change_requests` status `pending`.
3. `super_admin` approve.
4. Backend menerapkan perubahan ke `data_entries` dalam transaksi Prisma.

## Catatan Kompatibilitas Frontend

Seed data memakai field yang terlihat di frontend branch `dafi`: `namaProyek`, `idProyek`, `trlLevel`, `lokasi`, `baca`, `name`, `stockAwal`, `harga`, `status`, `namaKomoditas`, `proyeksiPanen`, `mitra`, `programStudi`, dan field tabel lain. Filter `year`, `month`, `page`, `offset`, `limit`, `search`, `sort_col`, `sort_order`, dan `view` didukung di generic data API.

## Quality Commands

```bash
npm run build
npm run lint
npm test
```

Tests mengasumsikan database sudah dimigrate dan diseed.

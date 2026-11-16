# Koya Clinic Booking

Next.js app with a patient booking page and the Koya assessment API contract. Supabase Postgres stores all state; database RPCs enforce slot exclusivity, idempotency, cancellation, pagination, and email throttling.

## Environment

Copy `.env.example` to `.env.local` and set:

- `SUPABASE_URL`: project API URL
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (legacy anon key also works)
- `API_KEY`: a random secret sent as `X-API-Key` to the contract endpoints

The API key is used only by server code. The browser UI calls same-origin routes and never receives it.

## Database Setup

Apply the files in `supabase/migrations/` in filename order. Then store the hash of the same API key configured in `API_KEY`:

```sql
insert into public.booking_api_settings(id, key_hash)
values (1, encode(extensions.digest(convert_to('YOUR_API_KEY', 'UTF8'), 'sha256'), 'hex'))
on conflict (id) do update set key_hash = excluded.key_hash;
```

The deployed assessment database has this migration applied and six sample future appointment slots. `POST /reset` replaces the schedule and clears bookings.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API

Every contract endpoint requires `X-API-Key`.

- `POST /reset` replaces slots
- `GET /slots?provider=Dr%20Ade` lists availability
- `POST /bookings` books a slot; supports `Idempotency-Key`
- `GET /bookings/{id}` looks up a booking
- `DELETE /bookings/{id}` cancels a booking
- `GET /bookings?email=...&limit=10&cursor=...` pages through a patient's bookings

Errors use `{"error":"..."}`. The booking page also supports lookup and cancellation.

## Deploy to Vercel

Import this repository into Vercel or use the Vercel CLI. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `API_KEY` as server environment variables before deploying. Do not configure these as `NEXT_PUBLIC_*` variables.
# koya-assessment

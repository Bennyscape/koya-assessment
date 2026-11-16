import {
  createBooking,
  listBookings,
} from "../_lib/booking-service.js";
import {
  hasApiKey,
  jsonResponse,
  readJson,
  resultResponse,
  serverError,
} from "../_lib/http.js";

export async function POST(request) {
  if (!hasApiKey(request)) return jsonResponse({ error: "unauthorized" }, 401);
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  try {
    const result = await createBooking(body, request.headers.get("idempotency-key"));
    return resultResponse(result);
  } catch {
    return serverError();
  }
}

export async function GET(request) {
  if (!hasApiKey(request)) return jsonResponse({ error: "unauthorized" }, 401);
  const params = new URL(request.url).searchParams;
  const email = params.get("email");
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 10 : Number(rawLimit);

  if (!email) return jsonResponse({ error: "email is required" }, 400);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return jsonResponse({ error: "limit must be between 1 and 50" }, 400);
  }

  try {
    return resultResponse(
      await listBookings(email, limit, params.get("cursor") || null),
    );
  } catch {
    return serverError();
  }
}
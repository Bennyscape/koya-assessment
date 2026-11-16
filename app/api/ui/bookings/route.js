import { createBooking, getBooking, listBookings } from "../../_lib/booking-service.js";
import { jsonResponse, readJson, resultResponse, serverError } from "../../_lib/http.js";

export async function POST(request) {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  try {
    return resultResponse(
      await createBooking(body, request.headers.get("idempotency-key")),
    );
  } catch {
    return serverError();
  }
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    try {
      return resultResponse(await getBooking(id));
    } catch {
      return serverError();
    }
  }

  const email = params.get("email");
  const reference = params.get("reference");
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 10 : Number(rawLimit);
  if (!email || !reference) {
    return jsonResponse({ error: "email and booking reference are required" }, 400);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return jsonResponse({ error: "limit must be between 1 and 50" }, 400);
  }
  try {
    const verification = await getBooking(reference);
    if (
      verification.status !== 200 ||
      verification.body.email.toLowerCase() !== email.trim().toLowerCase()
    ) {
      return jsonResponse({ error: "booking not found" }, 404);
    }
    return resultResponse(await listBookings(email, limit, params.get("cursor") || null));
  } catch {
    return serverError();
  }
}
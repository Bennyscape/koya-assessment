import { listSlots } from "../_lib/booking-service.js";
import { hasApiKey, resultResponse, jsonResponse, serverError } from "../_lib/http.js";

export async function GET(request) {
  if (!hasApiKey(request)) return jsonResponse({ error: "unauthorized" }, 401);
  try {
    const provider = new URL(request.url).searchParams.get("provider") || undefined;
    return resultResponse(await listSlots(provider));
  } catch {
    return serverError();
  }
}
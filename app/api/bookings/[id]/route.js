import { cancelBooking, getBooking } from "../../_lib/booking-service.js";
import {
  hasApiKey,
  jsonResponse,
  resultResponse,
  serverError,
} from "../../_lib/http.js";

export async function GET(request, context) {
  if (!hasApiKey(request)) return jsonResponse({ error: "unauthorized" }, 401);
  const { id } = await context.params;
  try {
    return resultResponse(await getBooking(id));
  } catch {
    return serverError();
  }
}

export async function DELETE(request, context) {
  if (!hasApiKey(request)) return jsonResponse({ error: "unauthorized" }, 401);
  const { id } = await context.params;
  try {
    return resultResponse(await cancelBooking(id));
  } catch {
    return serverError();
  }
}
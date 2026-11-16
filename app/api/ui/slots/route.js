import { listSlots } from "../../_lib/booking-service.js";
import { resultResponse, serverError } from "../../_lib/http.js";

export async function GET(request) {
  try {
    const provider = new URL(request.url).searchParams.get("provider") || undefined;
    return resultResponse(await listSlots(provider));
  } catch {
    return serverError();
  }
}
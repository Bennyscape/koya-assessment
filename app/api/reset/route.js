import { resetSlots } from "../_lib/booking-service.js";
import { hasApiKey, readJson, resultResponse, serverError } from "../_lib/http.js";

export async function POST(request) {
  if (!hasApiKey(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJson(request);
  if (!body || !Array.isArray(body.slots)) {
    return Response.json({ error: "slots must be an array" }, { status: 400 });
  }

  try {
    return resultResponse(await resetSlots(body.slots));
  } catch {
    return serverError();
  }
}
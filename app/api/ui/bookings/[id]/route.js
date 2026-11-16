import { cancelBooking } from "../../../_lib/booking-service.js";
import { resultResponse, serverError } from "../../../_lib/http.js";

export async function DELETE(_request, context) {
  const { id } = await context.params;
  try {
    return resultResponse(await cancelBooking(id));
  } catch {
    return serverError();
  }
}
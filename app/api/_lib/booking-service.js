import { createHash } from "node:crypto";
import { rpc } from "./supabase.js";

export async function listSlots(provider) {
  return rpc("list_slots", {
    p_api_key: process.env.API_KEY || "",
    p_provider: provider || null,
  });
}

export function createBooking(body, idempotencyKey) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");

  return rpc("create_booking", {
    p_api_key: process.env.API_KEY || "",
    p_slot_id: typeof body?.slot_id === "string" ? body.slot_id : null,
    p_name: typeof body?.name === "string" ? body.name : null,
    p_email: typeof body?.email === "string" ? body.email : null,
    p_idempotency_key: idempotencyKey || null,
    p_request_hash: requestHash,
  });
}

export async function getBooking(id) {
  return rpc("get_booking", {
    p_api_key: process.env.API_KEY || "",
    p_id: id,
  });
}

export function cancelBooking(id) {
  return rpc("cancel_booking", {
    p_api_key: process.env.API_KEY || "",
    p_id: id,
  });
}

export function listBookings(email, limit, cursor) {
  return rpc("list_bookings", {
    p_api_key: process.env.API_KEY || "",
    p_email: email,
    p_limit: limit,
    p_cursor: cursor,
  });
}

export function resetSlots(slots) {
  return rpc("reset_slots", {
    p_api_key: process.env.API_KEY || "",
    p_slots: slots,
  });
}
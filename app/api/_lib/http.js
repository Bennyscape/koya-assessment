export function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}

export function hasApiKey(request) {
  const expected = process.env.API_KEY;
  return Boolean(expected && request.headers.get("x-api-key") === expected);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function resultResponse(result) {
  const headers = {};
  if (result?.retry_after != null) {
    headers["Retry-After"] = String(result.retry_after);
  }
  return jsonResponse(result?.body ?? { error: "request failed" }, result?.status ?? 500, headers);
}

export function serverError() {
  return jsonResponse({ error: "internal server error" }, 500);
}
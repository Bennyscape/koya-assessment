export async function supabaseRequest(path, { method = "GET", body } = {}) {
  const projectUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!projectUrl || !publishableKey) {
    throw new Error("Supabase server environment is not configured");
  }

  const response = await fetch(
    `${projectUrl.replace(/\/$/, "")}/rest/v1/${path}`,
    {
      method,
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    },
  );

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status})`);
  }

  return payload;
}

export function rpc(name, args) {
  return supabaseRequest(`rpc/${name}`, { method: "POST", body: args });
}
// Helpers genéricos de fetch JSON usados pelas páginas públicas e por todos os painéis do
// admin. Extraído de src/main.jsx (organização de arquivos pedida pela Erica, 05/09/2026).

export async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'request_failed');
  return data;
}

export async function patchJson(url, payload) {
  const response = await fetch(url, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'request_failed');
  return data;
}

export async function api(path, options = {}) {
  const multipart = options.body instanceof FormData;
  const response = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...options,
    headers: multipart
      ? options.headers
      : { 'Content-Type': 'application/json', ...options.headers },
    body:
      options.body === undefined
        ? undefined
        : multipart
          ? options.body
          : JSON.stringify(options.body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.');
  return result;
}

// A member named like an API, a local named like one, and two real uses.
export function load() {
  const options = { fetch: 1, mode: process.env.NODE_ENV };
  const Blob = options.fetch;
  return fetch("https://example.com", { signal: new AbortController().signal }).then(() => Blob);
}

// True only for an http(s) URL whose host is this machine. Used to keep the
// fictional-fill demo tools off any hosted project.
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTS.includes(url.hostname)
    );
  } catch {
    return false;
  }
}

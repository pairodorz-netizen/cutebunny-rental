/**
 * BUG-507 — IP address redaction for structured logs.
 *
 * Scans JSON-serializable objects and redacts values for keys
 * that match IP-related field names, UNLESS the key contains
 * "masked_ip" (which indicates an already-masked value).
 */

const IP_FIELD_PATTERN = /^(ip_address|ipAddress|ip|client_ip|clientIp|remote_addr|remoteAddr)$/i;
const MASKED_IP_PATTERN = /masked_ip/i;

/**
 * Redact IP fields in a log payload.
 * Returns a new object with IP values replaced by '[REDACTED]'.
 */
export function redactIPFields<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactIPFields(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (IP_FIELD_PATTERN.test(key) && !MASKED_IP_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactIPFields(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

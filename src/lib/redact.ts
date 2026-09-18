const SECRET_KEY =
  /^(password|passwd|pwd|secret|secrets|token|accesstoken|refreshtoken|access_key|accesskey|accountkey|account_key|primarykey|primary_key|secondarykey|secondary_key|primaryconnectionstring|secondaryconnectionstring|connectionstring|connection_string|instrumentationkey|instrumentation_key|apikey|api_key|clientsecret|client_secret|sharedkey|shared_key|sas|sastoken|privatekey|private_key)$/i;

/** `value` only hides a secret when the surrounding command is about secrets or keys. */
const CONTEXTUAL_KEY = /^(value|contentbytes)$/i;
const SECRET_CONTEXT = /(secret|key|credential|password|token|sas)/i;

const SECRET_VALUE = /^(SharedAccessKey=|AccountKey=|sv=20\d\d-)/;

export const REDACTED = "***";

export interface RedactOptions {
  reveal?: boolean;
  /** Extra context (for example the az command) used for contextual keys. */
  context?: string;
}

/** Replace secret-looking values with `***` unless the caller opted into `--reveal`. */
export function redactSecrets<T>(value: T, options: RedactOptions = {}): T {
  if (options.reveal) return value;
  return redact(value, "", options.context ?? "") as T;
}

function redact(value: unknown, key: string, context: string): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item, key, context));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = redact(child, childKey, context);
    }
    return out;
  }
  if (typeof value !== "string" || value.length === 0) return value;
  if (SECRET_KEY.test(key)) return REDACTED;
  if (CONTEXTUAL_KEY.test(key) && SECRET_CONTEXT.test(context)) return REDACTED;
  if (SECRET_VALUE.test(value)) return REDACTED;
  return value;
}

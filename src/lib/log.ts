type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, fields: Record<string, unknown>, msg: string): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  process.stderr.write(line + "\n");
}

export const log = {
  debug: (fields: Record<string, unknown>, msg: string) => emit("debug", fields, msg),
  info: (fields: Record<string, unknown>, msg: string) => emit("info", fields, msg),
  warn: (fields: Record<string, unknown>, msg: string) => emit("warn", fields, msg),
  error: (fields: Record<string, unknown>, msg: string) => emit("error", fields, msg),
};

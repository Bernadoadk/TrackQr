import { isRouteErrorResponse } from "react-router";

function isHtmlResponse(data: unknown): data is string {
  if (typeof data !== "string") return false;
  const value = data.trim().toLowerCase();
  return value.startsWith("<script") || value.startsWith("<!doctype") || value.startsWith("<html");
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function messageFromData(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") {
    const parsed = tryParseJson(data);
    if (parsed !== data) return messageFromData(parsed);
    return data;
  }
  if (data instanceof Error) return data.message;
  if (Array.isArray(data)) {
    const messages = data.map(messageFromData).filter(Boolean);
    return messages.length > 0 ? messages.join("\n") : JSON.stringify(data, null, 2);
  }
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["message", "error_description", "error", "statusText"]) {
      const message = messageFromData(record[key]);
      if (message) return message;
    }
    if (Array.isArray(record.errors) || Array.isArray(record.userErrors)) {
      return messageFromData(record.errors ?? record.userErrors);
    }
    return JSON.stringify(record, null, 2);
  }
  return String(data);
}

export function RouteError({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error) && isHtmlResponse(error.data)) {
    return <div dangerouslySetInnerHTML={{ __html: error.data }} />;
  }

  const status = isRouteErrorResponse(error) ? error.status : 500;
  const statusText = isRouteErrorResponse(error) ? error.statusText : "Application error";
  const message = isRouteErrorResponse(error)
    ? messageFromData(error.data) || statusText
    : messageFromData(error) || "Something went wrong.";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f6f6f7",
        color: "#202223",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <section
        style={{
          width: "min(100%, 640px)",
          border: "1px solid #dfe3e8",
          borderRadius: 8,
          background: "#ffffff",
          padding: 24,
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
        }}
      >
        <p style={{ margin: "0 0 8px", color: "#6d7175", fontSize: 13 }}>
          Error {status}
        </p>
        <h1 style={{ margin: "0 0 12px", fontSize: 22, lineHeight: 1.25 }}>
          {statusText || "Application error"}
        </h1>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            font: "inherit",
            lineHeight: 1.5,
          }}
        >
          {message}
        </pre>
      </section>
    </main>
  );
}

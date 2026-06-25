import net from "node:net";
import tls from "node:tls";

type MailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
};

function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const rawPass = process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD ?? "";
  if (!host || !user || !rawPass) return null;

  const secure = (process.env.SMTP_SECURE ?? "true").toLowerCase() !== "false";
  const port = Number(process.env.SMTP_PORT ?? (secure ? 465 : 587));
  const pass = host.includes("gmail") ? rawPass.replace(/\s+/g, "") : rawPass;

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromEmail: process.env.SMTP_FROM_EMAIL?.trim() || user,
    fromName: process.env.SMTP_FROM_NAME?.trim() || "TrackQr",
  };
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function address(value: string) {
  return cleanHeader(value).match(/<([^>]+)>/)?.[1] ?? cleanHeader(value);
}

function formatAddress(email: string, name?: string) {
  const cleanEmail = address(email);
  const cleanName = name ? cleanHeader(name).replace(/"/g, "'") : "";
  return cleanName ? `"${cleanName}" <${cleanEmail}>` : cleanEmail;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dotStuff(value: string) {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

async function readResponse(socket: net.Socket | tls.TLSSocket) {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      if (/^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket: net.Socket | tls.TLSSocket, line: string, ok: number | number[]) {
  socket.write(`${line}\r\n`);
  const response = await readResponse(socket);
  const code = Number(response.slice(0, 3));
  const allowed = Array.isArray(ok) ? ok : [ok];
  if (!allowed.includes(code)) {
    throw new Error(`SMTP command failed (${line.split(" ")[0]}): ${response.trim()}`);
  }
  return response;
}

async function connect(config: SmtpConfig) {
  const socket = config.secure
    ? tls.connect(config.port, config.host, { servername: config.host })
    : net.connect(config.port, config.host);

  await new Promise<void>((resolve, reject) => {
    socket.once(config.secure ? "secureConnect" : "connect", resolve);
    socket.once("error", reject);
  });
  await readResponse(socket);

  if (!config.secure) {
    await command(socket, `EHLO ${config.host}`, 250);
    await command(socket, "STARTTLS", 220);
    const secureSocket = tls.connect({ socket, servername: config.host });
    await new Promise<void>((resolve, reject) => {
      secureSocket.once("secureConnect", resolve);
      secureSocket.once("error", reject);
    });
    return secureSocket;
  }

  return socket;
}

export async function sendSmtpMail(input: MailInput) {
  const config = smtpConfig();
  if (!config) throw new Error("SMTP is not configured");

  const socket = await connect(config);
  try {
    await command(socket, `EHLO ${config.host}`, 250);
    await command(socket, "AUTH LOGIN", 334);
    await command(socket, Buffer.from(config.user).toString("base64"), 334);
    await command(socket, Buffer.from(config.pass).toString("base64"), 235);
    await command(socket, `MAIL FROM:<${address(config.fromEmail)}>`, 250);
    await command(socket, `RCPT TO:<${address(input.to)}>`, [250, 251]);
    await command(socket, "DATA", 354);

    const html = input.html ?? `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(input.text)}</pre>`;
    const message = [
      `From: ${formatAddress(config.fromEmail, config.fromName)}`,
      `To: ${formatAddress(input.to)}`,
      `Subject: ${cleanHeader(input.subject)}`,
      input.replyTo ? `Reply-To: ${formatAddress(input.replyTo)}` : "",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
    ].filter(Boolean).join("\r\n");

    socket.write(`${dotStuff(message)}\r\n.\r\n`);
    const response = await readResponse(socket);
    if (Number(response.slice(0, 3)) !== 250) {
      throw new Error(`SMTP send failed: ${response.trim()}`);
    }
    await command(socket, "QUIT", 221);
  } finally {
    socket.end();
  }
}

export function leadNotificationHtml(input: {
  campaignName: string;
  customerEmail: string;
  fields: Record<string, string>;
  shopDomain?: string | null;
}) {
  const rows = Object.entries(input.fields)
    .filter(([key]) => key !== "blockId")
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5">
      <h2 style="margin:0 0 12px">New campaign lead</h2>
      <p style="margin:0 0 16px">A visitor submitted the campaign <strong>${escapeHtml(input.campaignName)}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;max-width:560px">
        <tr><td style="padding:8px;border:1px solid #e5e7eb">Customer email</td><td style="padding:8px;border:1px solid #e5e7eb">${escapeHtml(input.customerEmail)}</td></tr>
        ${input.shopDomain ? `<tr><td style="padding:8px;border:1px solid #e5e7eb">Shop</td><td style="padding:8px;border:1px solid #e5e7eb">${escapeHtml(input.shopDomain)}</td></tr>` : ""}
        ${rows}
      </table>
    </div>
  `;
}

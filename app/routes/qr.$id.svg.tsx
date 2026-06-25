import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { scanUrl } from "../lib/qr.server";
import { renderQrSvg, type QrLabelOpts } from "../lib/qr-render";
import { logoSvgDataUrl } from "../components/ui/LogoPicker";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const id = params.id;
  if (!id) throw new Response("Missing id", { status: 400 });
  const qr = await prisma.qrCode.findUnique({ where: { id } });
  if (!qr) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const size = Math.max(128, Math.min(2048, parseInt(url.searchParams.get("size") ?? "512", 10)));
  const includeLabel = url.searchParams.get("plain") !== "1";
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";

  const design = qr.design as Record<string, unknown>;
  const labelData = qr.label  as Record<string, unknown>;

  // Resolve logo to a data URL or absolute https URL.
  const logoBrand = (design.logoBrand as string | null | undefined) ?? null;
  const logoUrl   = (design.logoUrl   as string | null | undefined) ?? null;
  const logoDataUrl =
    logoBrand ? logoSvgDataUrl(logoBrand, 80) :
    logoUrl   ? logoUrl :
    undefined;

  const svg = renderQrSvg(scanUrl(qr.slug), {
    size,
    fg: (design.fg as string) ?? "#0B1220",
    bg: (design.bg as string) ?? "#FFFFFF",
    style: (design.style as "square" | "rounded" | "dot" | "classy") ?? "rounded",
    cornerStyle: (design.cornerStyle as "square" | "rounded" | "extra-rounded") ?? "rounded",
    withLogo: !!design.withLogo,
    logoDataUrl,
    // Advanced design fields (Batch A / B).
    logoSize:    (design.logoSize    as number | undefined),
    margin:      (design.margin      as number | undefined),
    cornerColor: (design.cornerColor as string | undefined),
    gradient:    (design.gradient    as { from: string; to: string; angle?: number } | null | undefined) ?? null,
    label: includeLabel ? {
      text:       labelData.text       as string | undefined,
      position:   labelData.position   as QrLabelOpts["position"],
      font:       labelData.font       as string | undefined,
      // Accept the new `frame` value, with fallback to legacy boolean `framed`.
      frame:      (labelData.frame as QrLabelOpts["frame"]) ?? ((labelData.framed as boolean | undefined) ? "outline" : "none"),
      // Rich-text formatting from the inline toolbar.
      size:       labelData.size       as number | undefined,
      bold:       labelData.bold       as boolean | undefined,
      italic:     labelData.italic     as boolean | undefined,
      underline:  labelData.underline  as boolean | undefined,
      align:      labelData.align      as "left" | "center" | "right" | undefined,
      labelColor: labelData.labelColor as string | undefined,
      bandColor:  labelData.bandColor  as string | undefined,
    } : undefined,
  });

  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `${disposition}; filename="${qr.slug}.svg"`,
      "Cache-Control": "public, max-age=300",
    },
  });
};

import type { ActionFunctionArgs } from "react-router";
import { requireShop } from "../lib/shop.server";
import { uploadImageToCloudinary } from "../lib/files.server";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "no-file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "too-large", message: "Max 2 MB" }, { status: 413 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ ok: false, error: "bad-type", message: "PNG, JPG, SVG, WebP or GIF only" }, { status: 415 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadImageToCloudinary({
      shopId: shop.id,
      file: {
        name: file.name || `logo-${Date.now()}`,
        mimeType: file.type,
        size: file.size,
        bytes,
      },
    });
    return Response.json({ ok: true, asset: uploaded });
  } catch (err) {
    console.error("[api.files.upload] failed", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return Response.json({ ok: false, error: "server", message }, { status: 500 });
  }
};

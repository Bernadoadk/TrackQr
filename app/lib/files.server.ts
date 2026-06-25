import prisma from "../db.server";
import crypto from "node:crypto";

interface AdminGraphqlClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<{ json: <T>() => Promise<T> }>;
}

interface StagedUploadCreatePayload {
  data: {
    stagedUploadsCreate: {
      stagedTargets: {
        url: string;
        resourceUrl: string;
        parameters: { name: string; value: string }[];
      }[];
      userErrors: { field: string[]; message: string }[];
    };
  };
}

export interface UploadedLogo {
  assetId: string;       // local Asset.id
  shopifyFileId: string; // legacy field; stores Shopify gid or Cloudinary public_id
  url: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
}

interface CloudinaryUploadResponse {
  public_id: string;
  secure_url: string;
  resource_type: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
}

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
  const folder = process.env.CLOUDINARY_UPLOAD_FOLDER?.trim() || "trackqr/campaigns";
  if (!cloudName) return null;
  return { cloudName, apiKey, apiSecret, uploadPreset, folder };
}

function cloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

export async function uploadImageToCloudinary(opts: {
  shopId: string;
  file: { name: string; mimeType: string; size: number; bytes: Buffer | ArrayBuffer };
}): Promise<UploadedLogo> {
  const config = cloudinaryConfig();
  if (!config) throw new Error("Cloudinary is not configured");
  if (!config.uploadPreset && (!config.apiKey || !config.apiSecret)) {
    throw new Error("Cloudinary needs either CLOUDINARY_UPLOAD_PRESET or CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET");
  }

  const bytes = opts.file.bytes instanceof Buffer ? new Uint8Array(opts.file.bytes) : new Uint8Array(opts.file.bytes);
  const blob = new Blob([bytes], { type: opts.file.mimeType });
  const form = new FormData();
  form.append("file", blob, opts.file.name);
  form.append("folder", config.folder);

  if (config.apiKey && config.apiSecret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signedParams: Record<string, string> = { folder: config.folder, timestamp };
    if (config.uploadPreset) signedParams.upload_preset = config.uploadPreset;
    form.append("api_key", config.apiKey);
    form.append("timestamp", timestamp);
    if (config.uploadPreset) form.append("upload_preset", config.uploadPreset);
    form.append("signature", cloudinarySignature(signedParams, config.apiSecret));
  } else if (config.uploadPreset) {
    form.append("upload_preset", config.uploadPreset);
  }

  const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });
  const json = await res.json() as CloudinaryUploadResponse & { error?: { message?: string } };
  if (!res.ok || !json.secure_url) {
    throw new Error(json.error?.message || `Cloudinary upload failed: ${res.status}`);
  }

  const asset = await prisma.asset.create({
    data: {
      shopId: opts.shopId,
      shopifyFileId: json.public_id,
      url: json.secure_url,
      mimeType: opts.file.mimeType,
      byteSize: json.bytes ?? opts.file.size,
      width: typeof json.width === "number" ? json.width : null,
      height: typeof json.height === "number" ? json.height : null,
    },
  });

  return {
    assetId: asset.id,
    shopifyFileId: json.public_id,
    url: asset.url,
    mimeType: asset.mimeType ?? opts.file.mimeType,
    byteSize: asset.byteSize ?? opts.file.size,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
  };
}

/**
 * 2-step Shopify Files upload:
 *   1) stagedUploadsCreate → returns a one-time upload URL on Shopify CDN
 *   2) POST the file bytes to that URL (multipart/form-data)
 *   3) fileCreate → registers the uploaded resource as a MediaImage
 *   4) persist an Asset row referencing the resulting URL
 *
 * Returns the persisted Asset so the caller can reference it on the QrCode.
 */
export async function uploadLogoToShopify(opts: {
  admin: AdminGraphqlClient;
  shopId: string;
  file: { name: string; mimeType: string; size: number; bytes: Buffer | ArrayBuffer };
}): Promise<UploadedLogo> {
  const { admin, shopId, file } = opts;

  // 1. stagedUploadsCreate
  const stageMutation = `#graphql
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;
  const stageRes = await admin.graphql(stageMutation, {
    variables: {
      input: [{
        resource: "IMAGE",
        filename: file.name,
        mimeType: file.mimeType,
        fileSize: String(file.size),
        httpMethod: "POST",
      }],
    },
  });
  const stageJson = await stageRes.json<StagedUploadCreatePayload>();
  if (stageJson.data.stagedUploadsCreate.userErrors.length) {
    throw new Error("stagedUploadsCreate: " + stageJson.data.stagedUploadsCreate.userErrors.map(e => e.message).join("; "));
  }
  const target = stageJson.data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("stagedUploadsCreate returned no targets");

  // 2. Upload the file bytes (multipart) to the staged URL.
  const formData = new FormData();
  for (const p of target.parameters) formData.append(p.name, p.value);
  // Some Node versions type Buffer as not assignable to BlobPart; coerce via Uint8Array.
  const bytes = file.bytes instanceof Buffer ? new Uint8Array(file.bytes) : new Uint8Array(file.bytes);
  const blob = new Blob([bytes], { type: file.mimeType });
  formData.append("file", blob, file.name);
  const upRes = await fetch(target.url, { method: "POST", body: formData });
  if (!upRes.ok && upRes.status !== 201) {
    const txt = await upRes.text();
    throw new Error(`Staged upload failed: ${upRes.status} ${txt.slice(0, 200)}`);
  }

  // 3. fileCreate — register as a MediaImage on the merchant store.
  const fileMutation = `#graphql
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on MediaImage {
            image { url width height }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const fileRes = await admin.graphql(fileMutation, {
    variables: {
      files: [{
        alt: file.name,
        contentType: "IMAGE",
        originalSource: target.resourceUrl,
      }],
    },
  });
  type FileCreatePayloadSafe = {
    data: {
      fileCreate: {
        files: { id: string; fileStatus: string; image?: { url?: string; width?: number; height?: number } }[];
        userErrors: { field: string[]; message: string }[];
      };
    };
  };
  const fileJson = await fileRes.json<FileCreatePayloadSafe>();
  if (fileJson.data.fileCreate.userErrors.length) {
    throw new Error("fileCreate: " + fileJson.data.fileCreate.userErrors.map(e => e.message).join("; "));
  }
  const created = fileJson.data.fileCreate.files[0];
  if (!created) throw new Error("fileCreate returned no files");

  // 4. Shopify processes the image asynchronously. The image URL may not be
  // immediately available; poll the file node a few times to retrieve it.
  let imageUrl = created.image?.url ?? "";
  let width  = created.image?.width;
  let height = created.image?.height;
  if (!imageUrl) {
    for (let i = 0; i < 6 && !imageUrl; i++) {
      await new Promise(r => setTimeout(r, 800));
      const poll = await admin.graphql(`#graphql
        query FileNode($id: ID!) {
          node(id: $id) {
            ... on MediaImage { image { url width height } }
          }
        }
      `, { variables: { id: created.id } });
      const pollJson = await poll.json<{ data: { node?: { image?: { url?: string; width?: number; height?: number } } } }>();
      imageUrl = pollJson.data.node?.image?.url ?? "";
      width  = pollJson.data.node?.image?.width  ?? width;
      height = pollJson.data.node?.image?.height ?? height;
    }
  }

  // 5. Persist Asset row.
  const asset = await prisma.asset.create({
    data: {
      shopId,
      shopifyFileId: created.id,
      url: imageUrl,
      mimeType: file.mimeType,
      byteSize: file.size,
      width:  typeof width  === "number" ? width  : null,
      height: typeof height === "number" ? height : null,
    },
  });

  return {
    assetId: asset.id,
    shopifyFileId: created.id,
    url: imageUrl,
    mimeType: file.mimeType,
    byteSize: file.size,
    width:  asset.width  ?? undefined,
    height: asset.height ?? undefined,
  };
}

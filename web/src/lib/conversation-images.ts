export type ProcessedImage = {
  id: string;
  name: string;
  dataUri: string;
  width: number;
  height: number;
};

export type RedactionRegion = { x: number; y: number; width: number; height: number };

const MAX_PIXELS = 32_000_000;
const MAX_WIDTH = 1200;
const PANEL_HEIGHT = 1600;
const PANEL_OVERLAP = 160;
const MAX_PANELS = 4;

function isSupportedMagic(bytes: Uint8Array): boolean {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return jpeg || png || webp;
}

function canvasDataUri(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** Re-encodes uploads, strips metadata, limits decoded pixels, and panels tall screenshots. */
export async function preprocessConversationImages(files: File[]): Promise<ProcessedImage[]> {
  const output: ProcessedImage[] = [];
  for (const file of files) {
    if (output.length >= MAX_PANELS) break;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`${file.name}: use a JPEG, PNG or WebP screenshot.`);
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!isSupportedMagic(bytes)) throw new Error(`${file.name}: file contents do not match a supported image format.`);
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error(`${file.name}: decoded image is too large.`);
      const scale = Math.min(1, MAX_WIDTH / bitmap.width);
      const scaledWidth = Math.max(1, Math.round(bitmap.width * scale));
      const scaledHeight = Math.max(1, Math.round(bitmap.height * scale));
      const panelHeight = Math.min(PANEL_HEIGHT, scaledHeight);
      const step = Math.max(1, panelHeight - PANEL_OVERLAP);
      for (let top = 0; top < scaledHeight && output.length < MAX_PANELS; top += step) {
        const height = Math.min(panelHeight, scaledHeight - top);
        const canvas = document.createElement("canvas");
        canvas.width = scaledWidth;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("This browser cannot process screenshots.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, scaledWidth, height);
        context.drawImage(bitmap, 0, top / scale, bitmap.width, height / scale, 0, 0, scaledWidth, height);
        output.push({ id: crypto.randomUUID(), name: scaledHeight > PANEL_HEIGHT ? `${file.name} · panel ${Math.floor(top / step) + 1}` : file.name, dataUri: canvasDataUri(canvas), width: scaledWidth, height });
        if (top + height >= scaledHeight) break;
      }
    } finally { bitmap.close(); }
  }
  if (output.length === 0) throw new Error("No usable screenshots were found.");
  return output;
}

/** Permanently burns opaque privacy masks into a re-encoded image before upload. */
export async function applyRedactions(image: ProcessedImage, regions: RedactionRegion[]): Promise<string> {
  if (regions.length === 0) return image.dataUri;
  const bitmap = await createImageBitmap(await fetch(image.dataUri).then((response) => response.blob()));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot apply redactions.");
    context.drawImage(bitmap, 0, 0, image.width, image.height);
    context.fillStyle = "#071412";
    for (const region of regions) {
      context.fillRect(region.x * image.width, region.y * image.height, region.width * image.width, region.height * image.height);
    }
    return canvasDataUri(canvas);
  } finally { bitmap.close(); }
}

export const SOURCE_IMAGE_MAX_DIMENSION = 1600;
export const SOURCE_IMAGE_OPTIMIZE_ABOVE_BYTES = 900_000;
export const SOURCE_IMAGE_WEBP_QUALITY = 0.82;

interface DecodedSourceImage {
  width: number;
  height: number;
  close?: () => void;
}

interface SourceImageCanvasContext {
  drawImage: (
    image: unknown,
    x: number,
    y: number,
    width: number,
    height: number
  ) => void;
}

interface SourceImageCanvas {
  width: number;
  height: number;
  getContext: (contextId: "2d") => SourceImageCanvasContext | null;
  toBlob: (
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number
  ) => void;
}

export interface SourceImageProcessingDependencies {
  createImageBitmap?: (file: File) => Promise<DecodedSourceImage>;
  createCanvas?: () => SourceImageCanvas;
}

export function canOptimizeSourceImages(files: File[]): boolean {
  return files.some((file) => file.size > SOURCE_IMAGE_OPTIMIZE_ABOVE_BYTES) &&
    typeof globalThis.createImageBitmap === "function" &&
    typeof document !== "undefined";
}

export async function prepareSourceImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map((file) => prepareSourceImage(file)));
}

export async function prepareSourceImage(
  file: File,
  dependencies: SourceImageProcessingDependencies = browserDependencies()
): Promise<File> {
  if (
    file.size <= SOURCE_IMAGE_OPTIMIZE_ABOVE_BYTES ||
    !dependencies.createImageBitmap ||
    !dependencies.createCanvas
  ) {
    return file;
  }

  let image: DecodedSourceImage | undefined;
  try {
    image = await dependencies.createImageBitmap(file);
    const scale = Math.min(
      1,
      SOURCE_IMAGE_MAX_DIMENSION / Math.max(image.width, image.height)
    );
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = dependencies.createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], webpName(file.name), {
      type: "image/webp",
      lastModified: file.lastModified
    });
  } catch {
    return file;
  } finally {
    image?.close?.();
  }
}

function canvasToBlob(canvas: SourceImageCanvas): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/webp", SOURCE_IMAGE_WEBP_QUALITY);
  });
}

function browserDependencies(): SourceImageProcessingDependencies {
  const bitmapFactory = typeof globalThis.createImageBitmap === "function"
    ? (file: File) => globalThis.createImageBitmap(file)
    : undefined;
  const canvasFactory = typeof document === "undefined"
    ? undefined
    : () => {
        const canvas = document.createElement("canvas");
        return {
          get width() {
            return canvas.width;
          },
          set width(value: number) {
            canvas.width = value;
          },
          get height() {
            return canvas.height;
          },
          set height(value: number) {
            canvas.height = value;
          },
          getContext: () => {
            const context = canvas.getContext("2d");
            return context
              ? {
                  drawImage: (
                    image: unknown,
                    x: number,
                    y: number,
                    width: number,
                    height: number
                  ) =>
                    context.drawImage(image as CanvasImageSource, x, y, width, height)
                }
              : null;
          },
          toBlob: canvas.toBlob.bind(canvas)
        };
      };
  return {
    createImageBitmap: bitmapFactory,
    createCanvas: canvasFactory
  };
}

function webpName(name: string): string {
  const extensionIndex = name.lastIndexOf(".");
  return `${extensionIndex > 0 ? name.slice(0, extensionIndex) : name}.webp`;
}

import {MAX_PHOTO_BYTES, validPhotoBytes} from './native/chart-archive-contract';

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 720;

/**
 * Turn an explicitly selected local photo into a small metadata-free JPEG.
 * The browser only reads the selected File, draws to an in-memory canvas and
 * gives bytes to the native encrypted store. No fetch/upload/remote URL.
 */
export async function preparePrivateChartPhoto(file: File): Promise<number[]> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      !file.size || file.size > MAX_SOURCE_BYTES) throw new Error('invalid_photo');

  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('invalid_photo'));
      image.src = sourceUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight ||
        image.naturalWidth > 10_000 || image.naturalHeight > 10_000) throw new Error('invalid_photo');

    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', {alpha:false});
    if (!ctx) throw new Error('invalid_photo');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.type !== 'image/jpeg' || blob.size > MAX_PHOTO_BYTES) continue;
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      if (validPhotoBytes(bytes)) return bytes;
    }
    throw new Error('invalid_photo');
  } finally {
    image.src = '';
    URL.revokeObjectURL(sourceUrl);
  }
}

import { Jimp, loadFont } from 'jimp';
// @ts-ignore
import { SANS_32_WHITE } from 'jimp/fonts';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

/**
 * Decodes, compresses, watermarks, and uploads an image to local disk.
 * 
 * @param userId User ID of the photo owner
 * @param photoBase64 Base64 string of the image
 * @param hostHeader Incoming request host header (e.g. 10.42.239.224:5000) for local URLs
 */
export const processAndUploadPhoto = async (
  userId: string,
  photoBase64: string,
  hostHeader: string
): Promise<string> => {
  try {
    // 1. Decode base64 to buffer
    const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // 2. Load image into Jimp
    const image = await Jimp.read(buffer);

    // 3. Compress & Resize (scale down to fit inside a 1000x1000 box, preserving aspect ratio)
    let w = image.width;
    let h = image.height;
    if (w > 1000 || h > 1000) {
      const ratio = w / h;
      if (w > h) {
        w = 1000;
        h = Math.round(1000 / ratio);
      } else {
        h = 1000;
        w = Math.round(1000 * ratio);
      }
      image.resize({ w, h });
    }

    const width = image.width;
    const height = image.height;

    // 4. Create text watermark layer
    const font = await loadFont(SANS_32_WHITE);
    const watermarkText = 'IRAI INAI';
    
    // Create transparent overlay image for watermark text
    const watermarkImg = new Jimp({ width: 220, height: 80, color: 0x00000000 });
    watermarkImg.print({ font, x: 10, y: 10, text: watermarkText });
    watermarkImg.opacity(0.15); // Set watermark transparency
    watermarkImg.rotate(-30); // Diagonal rotation

    const wWidth = watermarkImg.width;
    const wHeight = watermarkImg.height;

    // Composite watermark repeatedly across the image canvas
    for (let x = -wWidth / 3; x < width; x += wWidth + 120) {
      for (let y = -wHeight / 3; y < height; y += wHeight + 120) {
        image.composite(watermarkImg, x, y);
      }
    }

    // 5. Export processed buffer with JPEG compression
    const processedBuffer = await image.getBuffer('image/jpeg', { quality: 80 });
    const uniqueFilename = `photo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.jpg`;

    // 6. Local directory serving
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, uniqueFilename);
    fs.writeFileSync(filePath, processedBuffer);

    // Construct local public URL
    const scheme = 'http';
    const localUrl = `${scheme}://${hostHeader}/uploads/${uniqueFilename}`;
    logger.info(`Photo saved to local disk: ${localUrl}`);
    return localUrl;
  } catch (error: any) {
    logger.error(`processAndUploadPhoto error: ${error.message}`);
    throw new Error(`Image processing failed: ${error.message}`);
  }
};

/**
 * Resolves a stored photo URL/path.
 */
export const getImageUrl = async (photoUrl: string): Promise<string> => {
  return photoUrl;
};

/**
 * Processes and uploads multiple photos in parallel.
 */
export const processAndUploadPhotos = async (
  userId: string,
  photosBase64: string[],
  hostHeader: string
): Promise<string[]> => {
  const promises = photosBase64.map((base64) =>
    processAndUploadPhoto(userId, base64, hostHeader)
  );
  return Promise.all(promises);
};

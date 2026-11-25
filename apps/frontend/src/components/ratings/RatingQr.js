'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code (as an image) for a link. It is made in the browser, so the code in the link never goes to any other service. */
export default function RatingQr({ value, size = 128 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' }).then((url) => live && setSrc(url)).catch(() => live && setSrc(''));
    return () => { live = false; };
  }, [value, size]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="QR code that opens the rating page with your code filled in" data-testid="rating-qr" />;
}

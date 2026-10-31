import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #5b4bf0, #8b5cf6 50%, #ec4899)', color: '#fff', fontSize: 112, fontWeight: 800 }}>
        X
      </div>
    ),
    size,
  );
}

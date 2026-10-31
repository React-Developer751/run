import { ImageResponse } from 'next/og';

// PNG app icons for the web manifest (installable app needs 192 and 512). Generated once at build time.
export const dynamic = 'force-static';
export function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }];
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === '512' ? 512 : 192;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #5b4bf0, #8b5cf6 50%, #ec4899)', color: '#fff', fontSize: size * 0.62, fontWeight: 800 }}>
        X
      </div>
    ),
    { width: size, height: size },
  );
}

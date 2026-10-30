import { ImageResponse } from 'next/og';
import { getSiteName } from '@/lib/brand';

export const alt = 'Deploy React & Node.js apps from a GitHub link';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const name = await getSiteName();
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: 'linear-gradient(135deg, #f4f2ff 0%, #e4defe 55%, #fbd5ec 100%)',
          color: '#1b1646',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 84, height: 84, borderRadius: 24, background: 'linear-gradient(135deg, #5b4bf0, #8b5cf6 50%, #ec4899)', color: '#fff', fontSize: 56, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{name === 'HostX' ? 'X' : name.charAt(0).toUpperCase()}</div>
          <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: -2 }}>{name}</div>
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, marginTop: 40, display: 'flex', flexDirection: 'column' }}>
          <span>Ship your MERN app.</span>
          <span style={{ color: '#5b4bf0' }}>Just paste a link.</span>
        </div>
        <div style={{ fontSize: 32, color: '#58547f', marginTop: 34 }}>Free, self-hosted deploys for React &amp; Node.js</div>
      </div>
    ),
    size,
  );
}

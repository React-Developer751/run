'use client';

import { useEffect, useState } from 'react';

/** After "Delete my account" the user lands on /?deleted=1: say clearly that it worked. */
export function AccountDeletedNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('deleted') === '1') {
      setShow(true);
      window.history.replaceState(null, '', '/');
    }
  }, []);
  if (!show) return null;
  return (
    <div className="notice-box" role="status" style={{ maxWidth: 560, margin: '0 auto 24px', textAlign: 'left' }}>
      Your account and all of its apps were deleted. A confirmation email is on its way. Thanks for trying us out.
    </div>
  );
}

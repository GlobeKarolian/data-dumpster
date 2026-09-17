"use client";
import * as React from 'react';
export function CopyLink() {
  const [message, setMessage] = React.useState('');
  return <div className="v2-copy"><button type="button" className="v2-text-button" onClick={async () => {
    try { await navigator.clipboard.writeText(window.location.href); setMessage('Link copied'); }
    catch { setMessage('Copy this page’s address from your browser.'); }
  }}>Copy view link ↗</button><span role="status">{message}</span></div>;
}

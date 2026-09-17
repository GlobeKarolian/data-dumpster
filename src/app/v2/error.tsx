"use client";
import * as React from 'react';
import Link from 'next/link';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="v2-route-state" role="alert"><p className="v2-eyebrow">Data Dumpster / V2</p><h1>Observations could not be loaded.</h1><p>The read failed. No substitute values or generated narrative have been displayed.</p><div className="v2-actions"><button className="v2-button" onClick={() => reset()}>Retry read</button><Link className="v2-button" href="/v2">Choose a landscape</Link><Link className="v2-inline-link" href="/cross-channel">Original app ↗</Link></div></div>; }

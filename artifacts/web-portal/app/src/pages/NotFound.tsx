import { Link } from "wouter";

export default function NotFound() {
  return (
    <section className="vrt-page" aria-labelledby="nf-title">
      <div className="page-header">
        <h1 id="nf-title" data-testid="text-page-title">Page not found</h1>
      </div>
      <div className="vrt-state-card vrt-state-card--left">
        <p className="vrt-state-copy">This page isn't part of the new VRTSync app yet, or the link is out of date.</p>
        <Link href="/" className="btn btn-primary" data-testid="link-home">Go to Home</Link>
      </div>
    </section>
  );
}

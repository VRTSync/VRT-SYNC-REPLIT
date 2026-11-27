import { useMe, ROLE_DASHBOARD } from "../session";

export default function Home() {
  const { data } = useMe();
  const href = (data && ROLE_DASHBOARD[data.user.role]) || "/web/login";
  return (
    <section className="vrt-page" aria-labelledby="home-title">
      <div className="page-header">
        <h1 id="home-title" data-testid="text-page-title">Dashboard</h1>
      </div>
      <div className="vrt-state-card vrt-state-card--left">
        <p className="vrt-state-copy">The new dashboard is on its way. Your current dashboard is still here:</p>
        <a className="btn btn-primary" href={href} data-testid="link-web-dashboard">Open current dashboard</a>
      </div>
    </section>
  );
}

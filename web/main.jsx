import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutDashboard,
  KeyRound,
  Globe2,
  UserRound,
  ShieldCheck,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Download,
  Trash2,
  LogOut,
  Menu,
  Monitor,
  LockKeyhole,
  Shield,
  Loader2,
  ExternalLink,
  Info,
  Radio,
  Copy,
} from "lucide-react";
import "./styles.css";

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}
const formatDate = (d) =>
  new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function Mark({ small = false }) {
  return (
    <span className={`mark ${small ? "mark-small" : ""}`} aria-hidden="true">
      !
    </span>
  );
}
function Flag({ code }) {
  return (
    <span className={`flag flag-${code}`} aria-label={code}>
      {code === "SG" ? <span>☾</span> : null}
    </span>
  );
}
function GlobeArt() {
  return (
    <div className="globe-art" aria-hidden="true">
      <svg viewBox="0 0 440 350">
        <defs>
          <clipPath id="globe-clip">
            <circle cx="233" cy="187" r="128" />
          </clipPath>
          <radialGradient id="globe-shade" cx="32%" cy="24%">
            <stop offset="0" stopColor="#353c36" />
            <stop offset="1" stopColor="#202820" />
          </radialGradient>
        </defs>
        <g transform="rotate(-21 233 187)">
          <circle cx="233" cy="187" r="128" fill="url(#globe-shade)" />
          <g
            clipPath="url(#globe-clip)"
            fill="none"
            stroke="#77806f"
            strokeWidth=".7"
            opacity=".56"
          >
            {[-108, -72, -36, 0, 36, 72, 108].map((v, i) => (
              <ellipse
                key={i}
                cx="233"
                cy={187 + v}
                rx="128"
                ry={Math.max(6, 28 - Math.abs(v) / 5)}
              />
            ))}
            {[24, 64, 100, 128].map((r) => (
              <ellipse key={r} cx="233" cy="187" rx={r} ry="128" />
            ))}
          </g>
          <g clipPath="url(#globe-clip)" fill="#a8b49a" opacity=".42">
            <path d="m141 99 20-13 20 5 8 21 22 1 13 18-5 14-21 1-10 19 13 20-12 19-22-4-16-27-19-11-6-23-14-9zM201 206l25 2 16 22-4 23-17 21-6 21-13-12-3-25-15-27zM260 92l19-13 48 17 22 32-9 17-28-9-12 10-19-8-14 18-19-9 3-19-14-9zM258 164l27 1 17 21-12 43-20 23-13-17-10-35zM324 249l26-11 20 20-6 14-38-4z" />
          </g>
        </g>
        <ellipse
          cx="234"
          cy="188"
          rx="183"
          ry="50"
          transform="rotate(-29 234 188)"
          fill="none"
          stroke="#263328"
          strokeWidth="1"
          strokeDasharray="3 5"
          opacity=".55"
        />
        <path
          d="M97 213Q218 13 337 145"
          fill="none"
          stroke="#d9e3cd"
          strokeWidth="1.4"
          strokeDasharray="4 5"
        />
        <circle cx="171" cy="126" r="6" fill="#c9f0ab" />
        <circle
          cx="171"
          cy="126"
          r="12"
          fill="none"
          stroke="#c9f0ab"
          opacity=".35"
        />
        <circle cx="307" cy="201" r="5" fill="#c9f0ab" />
        <circle cx="252" cy="94" r="5" fill="#c9f0ab" />
        <text
          x="228"
          y="245"
          fill="#f5f4ef"
          fontSize="127"
          fontWeight="900"
          fontFamily="Arial"
          transform="rotate(12 233 187)"
        >
          !
        </text>
      </svg>
      <div className="globe-label">
        <span className="tiny-dot" /> OPEN INTERNET. OPEN POSSIBILITIES.
      </div>
    </div>
  );
}
function App() {
  const [page, setPage] = useState("Overview");
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [regions, setRegions] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("register");
  const [profileOpen, setProfileOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const [mobile, setMobile] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("All regions");
  const notify = (message) => setToast(message);
  async function reloadProfiles() {
    const data = await api("/profiles");
    setProfiles(data.profiles);
  }
  useEffect(() => {
    Promise.all([api("/config"), api("/regions"), api("/me")])
      .then(([c, r, u]) => {
        setConfig(c);
        setRegions(r.regions);
        setUser(u.user);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) reloadProfiles().catch((e) => setError(e.message));
    else setProfiles([]);
  }, [user]);
  useEffect(() => {
    if (!profiles.some((p) => ["issuing", "revoking"].includes(p.status)))
      return;
    const id = setInterval(
      () => reloadProfiles().catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(id);
  }, [profiles]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const active = profiles.filter((p) => !["revoked"].includes(p.status));
  const isLocal = config?.provisioner !== "aws";
  const login = (mode = "register") => {
    if (config?.authMode === "cognito") window.location.assign("/auth/login");
    else {
      setAuthMode(mode);
      setAuthOpen(true);
    }
  };
  const create = () => (user ? setProfileOpen(true) : login());
  const navigate = (p) => {
    setPage(p);
    setMobile(false);
  };
  async function logout() {
    try {
      const r = await api("/logout", { method: "POST" });
      setUser(null);
      navigate("Overview");
      if (r.redirect) window.location.assign(r.redirect);
      else notify("You have been signed out.");
    } catch (e) {
      setError(e.message);
    }
  }
  async function download(profile) {
    setBusy(true);
    try {
      const response = await fetch(`/api/profiles/${profile.id}/download`, {
        method: "POST",
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `navalnyvpn-${profile.region}-${profile.id.slice(-8)}.ovpn`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      await reloadProfiles();
      notify("Profile downloaded. Keep this file private.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function confirmRevoke() {
    setBusy(true);
    try {
      await api(`/profiles/${revoke.id}`, { method: "DELETE" });
      setRevoke(null);
      await reloadProfiles();
      notify(
        isLocal
          ? "Draft profile removed."
          : "Revocation requested. The gateway will invalidate the certificate.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function ProfileList({ compact = false }) {
    const list = compact ? profiles.slice(0, 3) : profiles;
    return list.length ? (
      <div className="profiles-table">
        {list.map((p) => (
          <div className="profile-row" key={p.id}>
            <div className="device-icon">
              <Monitor size={19} />
            </div>
            <div className="profile-details">
              <strong>{p.name}</strong>
              <span>
                {regions.find((r) => r.id === p.region)?.name || p.region}{" "}
                <span className="middot">·</span> {formatDate(p.created)}
              </span>
              {p.error && <span className="profile-error">{p.error}</span>}
            </div>
            <span className={`status status-${p.status}`}>
              {p.status === "draft"
                ? "Draft"
                : p.status === "active"
                  ? "Ready"
                  : p.status === "revoke_failed"
                    ? "Retry revocation"
                    : p.status.charAt(0).toUpperCase() + p.status.slice(1)}
            </span>
            {p.status === "active" && (
              <button
                className="icon-button"
                title={
                  p.downloaded ? "Already downloaded" : "Download .ovpn (once)"
                }
                disabled={busy || p.downloaded}
                onClick={() => download(p)}
              >
                <Download size={18} />
              </button>
            )}
            {!["revoked", "issuing", "revoking"].includes(p.status) && (
              <button
                className="icon-button danger"
                title="Revoke profile"
                onClick={() => setRevoke(p)}
              >
                <Trash2 size={17} />
              </button>
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="empty-profiles">
        <span className="empty-icon">
          <KeyRound size={23} />
        </span>
        <div>
          <h3>Your next connection starts here.</h3>
          <p>
            Create a profile, import it into OpenVPN, and make yourself at home.
          </p>
        </div>
        <button className="button button-outline" onClick={create}>
          Create a profile <Plus size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <a
          href="#overview"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <Mark />
          <span>
            Navalny<span className="brand-light">VPN</span>
          </span>
        </a>
        <div className="workspace-label">YOUR OPEN INTERNET</div>
        <nav aria-label="Main navigation">
          {[
            [LayoutDashboard, "Overview"],
            [KeyRound, "VPN profiles"],
            [Globe2, "Network"],
            [UserRound, "Account"],
          ].map(([Icon, label]) => (
            <button
              key={label}
              onClick={() => navigate(label)}
              className={`nav-item ${page === label ? "selected" : ""}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "VPN profiles" && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
              {label === page && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="free-card">
            <span className="free-symbol">✳</span>
            <strong>Freedom has no price.</strong>
            <p>
              Free to use. Built on open source.
              <br />
              For a more open internet.
            </p>
            <span className="free-tag">
              ALWAYS FREE <ArrowUpRight size={13} />
            </span>
          </div>
          <button className="nav-item" onClick={() => setGuideOpen(true)}>
            <BookOpen size={18} />
            <span>Connection guide</span>
            <ArrowUpRight size={15} />
          </button>
          <div className="sidebar-divider" />
          {user ? (
            <button
              className="sidebar-user"
              onClick={() => navigate("Account")}
            >
              <span className="avatar">{user.email[0].toUpperCase()}</span>
              <span>
                <strong>Your account</strong>
                <small>{user.email}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ) : (
            <button className="sidebar-user" onClick={() => login("login")}>
              <span className="avatar">
                <UserRound size={17} />
              </span>
              <span>
                <strong>Welcome, explorer</strong>
                <small>Sign in to get connected</small>
              </span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="open-source">
              <span className="tiny-dot" /> Built on open source
            </span>
            <span className="topbar-divider" />
            <button
              className="avatar small-avatar"
              aria-label={user ? "Open account" : "Sign in"}
              onClick={() => (user ? navigate("Account") : login("login"))}
            >
              {user ? user.email[0].toUpperCase() : <UserRound size={16} />}
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              <Info size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">LESS NOISE. MORE FREEDOM.</div>
              <h1>
                {page === "Overview"
                  ? "Your internet. Unrestricted."
                  : page === "VPN profiles"
                    ? "A connection of your own."
                    : page === "Network"
                      ? "Choose your point of view."
                      : "Your space. Your account."}
              </h1>
              <p>
                {page === "Overview"
                  ? "A little more privacy. A lot more possibility. Welcome to NavalnyVPN."
                  : page === "VPN profiles"
                    ? "Manage a separate, secure OpenVPN profile for each of your devices."
                    : page === "Network"
                      ? "One free network. Three regions. A world of possibilities."
                      : "Everything you need to manage your access to a freer internet."}
              </p>
            </div>
            <span className="plan-tag">
              <span className="tiny-dot" /> FREE PLAN
            </span>
          </div>
          {loading ? (
            <div className="loading-state">
              <Loader2 className="spin" /> Loading your workspace…
            </div>
          ) : (
            <>
              {page === "Overview" && (
                <>
                  <section className="hero">
                    <div className="hero-copy">
                      <span className="hero-kicker">
                        <span className="small-star">✳</span> THE INTERNET
                        BELONGS TO EVERYONE.
                      </span>
                      <h2>
                        A freer internet.
                        <br />
                        One connection away.
                      </h2>
                      <p>
                        Take back your corner of the web. Private connections,
                        <br className="desktop-break" /> fewer ads, and
                        protection that comes built in.
                      </p>
                      <button className="button button-dark" onClick={create}>
                        Create your VPN profile <ArrowUpRight size={18} />
                      </button>
                      <div className="hero-footnote">
                        <LockKeyhole size={13} /> No subscription. No payment
                        details. Just connect.
                      </div>
                    </div>
                    <GlobeArt />
                  </section>
                  <section
                    className="stats-grid"
                    aria-label="Workspace summary"
                  >
                    <div className="stat-card">
                      <div className="stat-label">
                        <span>Your profiles</span>
                        <KeyRound size={18} />
                      </div>
                      <div className="stat-value">
                        {String(active.length).padStart(2, "0")}
                        <span>/ 05</span>
                      </div>
                      <p>A connection for each of your devices</p>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">
                        <span>Global network</span>
                        <Globe2 size={18} />
                      </div>
                      <div className="stat-value">
                        {String(regions.length).padStart(2, "0")}
                        <span>regions</span>
                      </div>
                      <p>Find a connection closer to you</p>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">
                        <span>Built-in protection</span>
                        <ShieldCheck size={18} />
                      </div>
                      <div className="protection-value">
                        <span className="protection-dot" />{" "}
                        {isLocal ? "Ready to deploy" : "DNS filtering"}
                      </div>
                      <p>Ad & adult-domain blocking with Pi-hole</p>
                    </div>
                  </section>
                  <section className="section-block">
                    <div className="section-heading">
                      <div>
                        <h2>
                          Your VPN profiles{" "}
                          <span className="count-chip">{active.length}</span>
                        </h2>
                        <p>Your keys to a more open internet.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("VPN profiles")}
                      >
                        Manage profiles <ArrowRight size={16} />
                      </button>
                    </div>
                    <ProfileList compact />
                  </section>
                </>
              )}
              {page === "VPN profiles" && (
                <section className="section-block profiles-page">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Your devices{" "}
                        <span className="count-chip">{active.length} / 5</span>
                      </h2>
                      <p>
                        Download each profile once. Store it securely and never
                        share it.
                      </p>
                    </div>
                    <button className="button button-dark" onClick={create}>
                      <Plus size={17} /> Create profile
                    </button>
                  </div>
                  {!user && (
                    <div className="inline-note">
                      <LockKeyhole size={17} /> Sign in to create and manage
                      your profiles.{" "}
                      <button
                        className="text-button"
                        onClick={() => login("login")}
                      >
                        Sign in <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  <ProfileList />
                  {isLocal && (
                    <div className="inline-note">
                      <Info size={17} />
                      <span>
                        This is a local workspace. Profiles are saved as drafts;
                        certificate downloads require deployed AWS gateways.
                      </span>
                    </div>
                  )}
                  <div className="profile-help">
                    <BookOpen size={23} />
                    <div>
                      <h3>New to OpenVPN?</h3>
                      <p>
                        It takes just a few steps to get connected on your
                        computer, phone, or compatible router.
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setGuideOpen(true)}
                    >
                      Read the guide <ArrowUpRight size={17} />
                    </button>
                  </div>
                </section>
              )}
              {(page === "Overview" || page === "Network") && (
                <section className="section-block">
                  <div className="section-heading">
                    <div>
                      <h2>
                        A world without borders <Globe2 size={17} />
                      </h2>
                      <p>Choose a region. Make a connection.</p>
                    </div>
                    {page === "Overview" ? (
                      <button
                        className="region-filter"
                        onClick={() => navigate("Network")}
                      >
                        All regions <ChevronDown size={14} />
                      </button>
                    ) : (
                      <select
                        className="region-filter"
                        aria-label="Filter region"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        {[
                          "All regions",
                          "Europe",
                          "North America",
                          "Asia Pacific",
                        ].map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="regions-grid">
                    {regions
                      .filter(
                        (r) =>
                          filter === "All regions" ||
                          page === "Overview" ||
                          r.continent === filter,
                      )
                      .map((r, i) => (
                        <button
                          className="region-card"
                          key={r.id}
                          onClick={() =>
                            user ? setProfileOpen(r.id) : login()
                          }
                        >
                          <div className="region-card-top">
                            <Flag code={r.code} />
                            <span className="region-code">{r.id}</span>
                            <ArrowUpRight size={16} />
                          </div>
                          <div className="region-card-body">
                            <div>
                              <h3>{r.name}</h3>
                              <p>{r.country}</p>
                            </div>
                            <span
                              className="region-mini-map"
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 80 50">
                                <path
                                  d={
                                    i % 3 === 0
                                      ? "M26 3 40 5 43 13 56 16 50 26 59 35 43 47 34 37 21 39 17 25 25 17Z"
                                      : i % 3 === 1
                                        ? "M5 6 35 3 46 12 69 10 73 19 51 26 45 40 32 47 25 29 10 22Z"
                                        : "M6 8 29 4 36 15 61 9 73 19 59 33 40 29 35 45 22 32 10 28Z"
                                  }
                                />
                                <circle cx="40" cy="24" r="4" />
                              </svg>
                            </span>
                          </div>
                          <div className="region-card-footer">
                            <span>
                              <span
                                className={`tiny-dot ${r.configured ? "" : "dot-muted"}`}
                              />
                              {r.configured
                                ? "Gateway configured"
                                : "Deployment required"}
                            </span>
                            <span>
                              OpenVPN <ShieldCheck size={12} />
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </section>
              )}
              {page === "Network" && (
                <section className="network-details">
                  <div className="network-feature">
                    <ShieldCheck size={25} />
                    <h2>Cleaner at the network level.</h2>
                    <p>
                      Each gateway routes VPN DNS through Pi-hole. Ad, tracker,
                      and adult-domain lists apply to every device using that
                      tunnel, including devices behind a VPN-enabled router.
                    </p>
                  </div>
                  <div className="network-feature">
                    <LockKeyhole size={25} />
                    <h2>A private way through.</h2>
                    <p>
                      OpenVPN Community Edition uses individual device
                      certificates and encrypted tunnels. Standard DNS is
                      redirected to Pi-hole; encrypted DNS can bypass domain
                      filtering.
                    </p>
                  </div>
                  <div className="network-note">
                    <Info size={18} />
                    <p>
                      Region cards show deployment configuration, not live
                      connection status. This website creates profiles; use an
                      OpenVPN client to connect. Enable your client’s kill
                      switch and IPv6 leak protection.
                    </p>
                  </div>
                </section>
              )}
              {page === "Account" && (
                <section className="account-grid">
                  <div className="account-card">
                    <div className="account-title">
                      <UserRound size={22} />
                      <h2>Your account</h2>
                    </div>
                    {user ? (
                      <>
                        <span className="field-label">EMAIL ADDRESS</span>
                        <p className="account-email">{user.email}</p>
                        <span className="field-label">MEMBER SINCE</span>
                        <p>{formatDate(user.created)}</p>
                        <div className="account-plan">
                          <span>
                            <span className="tiny-dot" /> Free plan
                          </span>
                          <strong>
                            $0 <small>/ always</small>
                          </strong>
                        </div>
                        <button
                          className="button button-outline"
                          onClick={logout}
                        >
                          <LogOut size={16} /> Sign out
                        </button>
                      </>
                    ) : (
                      <>
                        <h3>A freer internet starts with you.</h3>
                        <p>
                          Create an account to keep your device profiles in one
                          place.
                        </p>
                        <button
                          className="button button-dark"
                          onClick={() => login()}
                        >
                          Create free account <ArrowUpRight size={17} />
                        </button>
                        <button
                          className="text-button account-login"
                          onClick={() => login("login")}
                        >
                          Already have an account? Sign in
                        </button>
                      </>
                    )}
                  </div>
                  <div className="account-card account-privacy">
                    <Shield size={25} />
                    <h2>Privacy, with a little clarity.</h2>
                    <p>
                      Your email identifies your account. We store profile
                      names, regions, certificate identifiers, and creation
                      dates to manage your access.
                    </p>
                    <p>
                      Gateway DNS query history is disabled by default.
                      Operational logs can still contain connection metadata;
                      this service does not claim audited anonymity.
                    </p>
                    <p>
                      Signing out ends your web session. To stop a device
                      connecting, revoke its VPN profile.
                    </p>
                  </div>
                </section>
              )}
              {page === "Overview" && (
                <section className="protection-strip">
                  <div className="protection-icon">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <h3>A quieter internet comes standard.</h3>
                    <p>
                      Network-wide ad & adult-domain blocking. Powered by
                      Pi-hole.
                    </p>
                  </div>
                  <span className="included-tag">
                    <Check size={14} /> Included, always
                  </span>
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              <span className="footer-mark">!</span> A freer internet is worth
              building.
            </span>
            <div>
              <span>Free. Open source. For everyone.</span>
              <button
                className="text-button"
                onClick={() => setGuideOpen(true)}
              >
                Get connected <ArrowUpRight size={13} />
              </button>
            </div>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {authOpen && (
        <Modal
          title={
            authMode === "register"
              ? "Your internet starts here."
              : "Good to see you again."
          }
          onClose={() => setAuthOpen(false)}
        >
          <AuthForm
            mode={authMode}
            setMode={setAuthMode}
            onSuccess={(u) => {
              setUser(u);
              setAuthOpen(false);
              notify("You’re signed in. Create a profile to get started.");
            }}
          />
        </Modal>
      )}
      {profileOpen && (
        <Modal
          title="Make your next connection."
          onClose={() => setProfileOpen(false)}
        >
          <ProfileForm
            regions={regions}
            initialRegion={
              typeof profileOpen === "string" ? profileOpen : regions[0]?.id
            }
            isLocal={isLocal}
            onSuccess={async () => {
              setProfileOpen(false);
              navigate("VPN profiles");
              await reloadProfiles();
              notify(
                isLocal
                  ? "Draft saved. Deploy a gateway to create a usable VPN profile."
                  : "Your device certificate is being created.",
              );
            }}
          />
        </Modal>
      )}
      {revoke && (
        <Modal
          title={isLocal ? "Remove this draft?" : "Revoke this VPN profile?"}
          onClose={() => setRevoke(null)}
        >
          <p className="modal-description">
            {isLocal
              ? `Remove “${revoke.name}” from your profiles.`
              : `“${revoke.name}” will no longer be able to connect after the gateway processes the revocation. This cannot be undone.`}
          </p>
          <div className="modal-actions">
            <button
              className="button button-outline"
              onClick={() => setRevoke(null)}
            >
              Keep profile
            </button>
            <button
              className="button button-danger"
              disabled={busy}
              onClick={confirmRevoke}
            >
              {busy ? <Loader2 size={16} className="spin" /> : null}
              {isLocal ? "Remove draft" : "Revoke profile"}
            </button>
          </div>
        </Modal>
      )}
      {guideOpen && (
        <Modal
          title="A few steps to a freer internet."
          onClose={() => setGuideOpen(false)}
          wide
        >
          <p className="modal-description">
            NavalnyVPN profiles work with OpenVPN Connect and OpenVPN Community
            clients.
          </p>
          <ol className="guide-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Get an OpenVPN client.</h3>
                <p>
                  Install the official client for Windows, macOS, Android, or
                  iOS, or use OpenVPN Community on Linux.
                </p>
                <a
                  href="https://openvpn.net/client/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get OpenVPN Connect <ExternalLink size={14} />
                </a>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Create a profile for your device.</h3>
                <p>
                  Sign in, choose a region, and name your device. When your
                  profile is ready, download the .ovpn file once. Treat it like
                  a password.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Import. Connect. Explore.</h3>
                <p>
                  Import the .ovpn file into your client, enable IPv6 leak
                  protection and the kill switch, then connect. Import the
                  profile into a compatible router to protect devices on your
                  home network.
                </p>
              </div>
            </li>
          </ol>
          <div className="inline-note">
            <Info size={18} />
            <p>
              Pi-hole filters domains, so it cannot block every in-app ad or
              guarantee adult-content blocking. Disable browser secure DNS if
              you want all DNS requests filtered. OpenVPN is not traffic
              obfuscation and may be blocked on restrictive networks.
            </p>
          </div>
          <button
            className="button button-dark"
            onClick={() => {
              setGuideOpen(false);
              create();
            }}
          >
            Create a VPN profile <ArrowUpRight size={17} />
          </button>
        </Modal>
      )}
    </div>
  );
}
function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const previous = document.activeElement;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        className={`modal ${wide ? "modal-wide" : ""}`}
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={(node) => {
          if (node && !node.contains(document.activeElement))
            node.querySelector("input,button,select,a")?.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const elements = e.currentTarget.querySelectorAll(
              "button:not(:disabled),input,select,a[href]",
            );
            const first = elements[0],
              last = elements[elements.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="modal-brand">
          <Mark small />
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <h2 id="modal-title">{title}</h2>
        {children}
      </dialog>
    </div>
  );
}
function AuthForm({ mode, setMode, onSuccess }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const r = await api(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      onSuccess(r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="modal-description">
        {mode === "register"
          ? "One free account. A connection for every device."
          : "Sign in to manage your VPN profiles."}
      </p>
      <form onSubmit={submit}>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            minLength={12}
            maxLength={128}
            required
            placeholder="At least 12 characters"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-dark full-width" disabled={busy}>
          {busy ? <Loader2 size={17} className="spin" /> : null}
          {mode === "register" ? "Create free account" : "Sign in"}
          <ArrowUpRight size={17} />
        </button>
      </form>
      <p className="auth-switch">
        {mode === "register" ? "Already have an account?" : "New around here?"}{" "}
        <button
          onClick={() => {
            setMode(mode === "register" ? "login" : "register");
            setError("");
          }}
        >
          {mode === "register" ? "Sign in" : "Create an account"}
        </button>
      </p>
      <div className="local-mode-note">
        <Info size={14} /> Local development account. Email verification and
        recovery use Cognito after AWS deployment.
      </div>
    </>
  );
}
function ProfileForm({ regions, initialRegion, isLocal, onSuccess }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/profiles", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="modal-description">
        Give your device its own keys to the internet.
      </p>
      <form onSubmit={submit}>
        <label>
          Device name
          <input
            name="name"
            placeholder="e.g. My laptop"
            maxLength={48}
            required
            autoComplete="off"
          />
        </label>
        <label>
          Connection region
          <select name="region" defaultValue={initialRegion}>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}, {r.country}
              </option>
            ))}
          </select>
        </label>
        <div className="profile-includes">
          <span>
            <Check size={14} /> OpenVPN compatible
          </span>
          <span>
            <Check size={14} /> Ad & adult-domain filtering
          </span>
        </div>
        {isLocal && (
          <div className="inline-note">
            <Info size={17} />
            <span>
              This saves a draft. Deploy the AWS infrastructure before creating
              a downloadable certificate.
            </span>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-dark full-width" disabled={busy}>
          {busy ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}{" "}
          {isLocal ? "Save draft profile" : "Create VPN profile"}
        </button>
      </form>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);

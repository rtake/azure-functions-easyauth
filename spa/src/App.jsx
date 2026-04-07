import { useEffect, useState } from "react";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function getLoginUrl() {
  const redirectUri = encodeURIComponent(window.location.href);
  return `${apiBaseUrl}/.auth/login/aad?post_login_redirect_uri=${redirectUri}`;
}

function getLogoutUrl() {
  const redirectUri = encodeURIComponent(window.location.origin);
  return `${apiBaseUrl}/.auth/logout?post_logout_redirect_uri=${redirectUri}`;
}

function stringify(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default function App() {
  const [result, setResult] = useState("Loading...");

  async function loadProfile() {
    if (!apiBaseUrl) {
      setResult(
        "VITE_API_BASE_URL を設定してください。例: https://func-xxxxxx.azurewebsites.net",
      );
      return;
    }

    setResult("Loading profile...");

    try {
      const response = await fetch(`${apiBaseUrl}/api/profile`, {
        credentials: "include",
        headers: {
          accept: "application/json",
        },
      });

      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (response.status === 401) {
        setResult(
          stringify({
            authenticated: false,
            message:
              "未認証です。Sign in を押して Function App の Easy Auth へ遷移してください。",
            detail: payload,
          }),
        );
        return;
      }

      if (!response.ok) {
        setResult(
          stringify({
            error: `HTTP ${response.status}`,
            detail: payload,
          }),
        );
        return;
      }

      setResult(
        stringify({
          authenticated: true,
          profile: payload,
        }),
      );
    } catch (error) {
      setResult(
        stringify({
          error: "Request failed",
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Azure Functions + Easy Auth</p>
        <h1>Cookie session based React SPA</h1>
        <p className="lead">
          ブラウザへアクセストークンを渡さず、Function App の Easy Auth
          セッションだけでバックエンド API を呼び出す React サンプルです。
        </p>

        <div className="actions">
          <button type="button" onClick={() => (window.location.href = getLoginUrl())}>
            Sign in
          </button>
          <button type="button" onClick={() => void loadProfile()}>
            Load profile
          </button>
          <button type="button" onClick={() => (window.location.href = getLogoutUrl())}>
            Sign out
          </button>
        </div>

        <dl className="meta">
          <div>
            <dt>SPA origin</dt>
            <dd>{window.location.origin}</dd>
          </div>
          <div>
            <dt>API base URL</dt>
            <dd>{apiBaseUrl || "VITE_API_BASE_URL を設定してください"}</dd>
          </div>
        </dl>

        <pre className="result">{result}</pre>
      </section>
    </main>
  );
}

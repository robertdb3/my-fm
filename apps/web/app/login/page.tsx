"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { login, setAuthToken } from "../../src/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("change-me");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await login(email, password);
      setAuthToken(response.token);
      router.push("/stations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 520, margin: "3rem auto" }}>
      <h1>Sign in</h1>
      <p className="meta">Use the app account configured in API env vars.</p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </section>
  );
}

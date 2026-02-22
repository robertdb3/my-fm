"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiRequestError, importLibrary, testNavidromeConnection } from "../../src/lib/api";
import { useRequireAuth } from "../../src/lib/useRequireAuth";

const STORAGE_KEY = "music-cable-box-navidrome-settings";

export default function SettingsPage() {
  const token = useRequireAuth();
  const [baseUrl, setBaseUrl] = useState("http://localhost:4533");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [maxArtists, setMaxArtists] = useState(5000);
  const [fullResync, setFullResync] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [pendingTest, setPendingTest] = useState(false);
  const [pendingImport, setPendingImport] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        baseUrl?: string;
        username?: string;
      };

      if (parsed.baseUrl) {
        setBaseUrl(parsed.baseUrl);
      }

      if (parsed.username) {
        setUsername(parsed.username);
      }
    } catch {
      // Ignore invalid local state.
    }
  }, []);

  if (!token) {
    return <section className="card">Checking auth...</section>;
  }

  async function onTestConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setPendingTest(true);

    try {
      const response = await testNavidromeConnection(
        {
          baseUrl,
          username,
          password
        },
        token
      );

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          baseUrl,
          username
        })
      );

      setStatus(`Connected. Tokenized credentials saved for ${response.account.username}.`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError("Failed to connect to Navidrome.");
      }
    } finally {
      setPendingTest(false);
    }
  }

  async function onImportLibrary() {
    setPendingImport(true);
    setError(null);
    setImportResult(null);

    try {
      const response = await importLibrary(
        {
          fullResync,
          maxArtists
        },
        token
      );

      setImportResult(
        `Imported artists: ${response.result.importedArtists}, albums: ${response.result.importedAlbums}, tracks: ${response.result.importedTracks}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Library import failed");
    } finally {
      setPendingImport(false);
    }
  }

  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "span 7" }}>
        <h1>Navidrome Settings</h1>
        <p className="meta">
          Credentials are converted to Subsonic token+salt and persisted in the app DB. The raw password is
          used only to derive token material.
        </p>

        <form onSubmit={onTestConnection} style={{ display: "grid", gap: "0.85rem" }}>
          <label>
            Navidrome URL
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              type="url"
              required
              placeholder="http://localhost:4533"
            />
          </label>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} required />
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

          {status ? <p>{status}</p> : null}
          {error ? <p className="error">{error}</p> : null}

          <button type="submit" className="primary" disabled={pendingTest}>
            {pendingTest ? "Testing..." : "Test & Save Connection"}
          </button>
        </form>
      </section>

      <section className="card" style={{ gridColumn: "span 5" }}>
        <h2>Import Library</h2>
        <p className="meta">Imports metadata into local cache for fast station generation.</p>

        <label>
          Max artists per import run
          <input
            type="number"
            min={1}
            max={10000}
            value={maxArtists}
            onChange={(event) => setMaxArtists(Number(event.target.value))}
          />
        </label>

        <label style={{ marginTop: "0.8rem" }}>
          <input
            type="checkbox"
            checked={fullResync}
            onChange={(event) => setFullResync(event.target.checked)}
            style={{ width: "auto", marginRight: "0.5rem" }}
          />
          Full resync (clears existing cache first)
        </label>

        <div style={{ marginTop: "1rem", display: "grid", gap: "0.7rem" }}>
          <button className="primary" onClick={onImportLibrary} disabled={pendingImport}>
            {pendingImport ? "Importing..." : "Import from Navidrome"}
          </button>
          {importResult ? <p>{importResult}</p> : null}
        </div>
      </section>
    </div>
  );
}

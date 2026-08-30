"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiRequestError,
  getNavidromeAccount,
  importLibrary,
  testNavidromeConnection,
  type SavedNavidromeAccount
} from "../../src/lib/api";

export default function SettingsPage() {
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
  const [savedAccount, setSavedAccount] = useState<SavedNavidromeAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);

  useEffect(() => {
    // The saved connection lives on the server, not in this browser, so it
    // shows up the same on every device.
    getNavidromeAccount()
      .then((account) => {
        setSavedAccount(account);
        if (account) {
          setBaseUrl(account.baseUrl);
          setUsername(account.username);
        }
      })
      .catch(() => {
        // Leave the form on its defaults; the error surfaces when saving.
      })
      .finally(() => {
        setLoadingAccount(false);
      });
  }, []);

  async function onTestConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setPendingTest(true);

    try {
      const response = await testNavidromeConnection({
        baseUrl,
        username,
        password
      });

      setSavedAccount(response.account);
      setBaseUrl(response.account.baseUrl);
      setPassword("");
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
      const response = await importLibrary({
        fullResync,
        maxArtists
      });

      setImportResult(
        `Imported artists: ${response.result.importedArtists}, albums: ${response.result.importedAlbums}, tracks: ${response.result.importedTracks}`
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setError("An import is already running. Give it a few minutes to finish.");
      } else {
        setError(err instanceof Error ? err.message : "Library import failed");
      }
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

        {loadingAccount ? (
          <p className="meta">Checking saved connection...</p>
        ) : savedAccount ? (
          <p className="meta">
            Connected as <strong>{savedAccount.username}</strong> at <strong>{savedAccount.baseUrl}</strong>{" "}
            (saved {new Date(savedAccount.updatedAt).toLocaleString()}). Re-enter the password only to change
            the saved credentials.
          </p>
        ) : (
          <p className="meta">No Navidrome connection saved yet.</p>
        )}

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
        <p className="meta">
          Imports metadata into local cache for fast station generation. A full library takes a few minutes
          and the page will sit on &quot;Importing...&quot; until it finishes — that is expected, not a hang.
        </p>

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

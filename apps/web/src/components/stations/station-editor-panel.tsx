"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Station, StationRules } from "@music-cable-box/shared";
import { ApiRequestError, previewStationRules } from "../../lib/api";
import {
  createDefaultStationRuleDraft,
  StationRuleBuilder,
  stationRulesToDraft,
  validateRuleDraft,
  type StationRuleDraft
} from "./station-rule-builder";

export interface StationSavePayload {
  stationId?: string;
  name: string;
  description?: string;
  rules: StationRules;
  isEnabled: boolean;
}

interface StationEditorDraft {
  name: string;
  description: string;
  isEnabled: boolean;
  rules: StationRuleDraft;
}

function createDefaultEditorDraft(): StationEditorDraft {
  return {
    name: "",
    description: "",
    isEnabled: true,
    rules: createDefaultStationRuleDraft()
  };
}

function stationToEditorDraft(station: Station): StationEditorDraft {
  return {
    name: station.name,
    description: station.description ?? "",
    isEnabled: station.isEnabled,
    rules: stationRulesToDraft(station.rules)
  };
}

interface StationEditorPanelProps {
  token: string;
  editingStation: Station | null;
  pending: boolean;
  onSave(payload: StationSavePayload): Promise<void>;
  onDelete(stationId: string): Promise<void>;
  onDuplicate(station: Station): Promise<void>;
  onCancelEdit(): void;
}

export function StationEditorPanel({
  token,
  editingStation,
  pending,
  onSave,
  onDelete,
  onDuplicate,
  onCancelEdit
}: StationEditorPanelProps) {
  const [draft, setDraft] = useState<StationEditorDraft>(createDefaultEditorDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestSeqRef = useRef(0);

  useEffect(() => {
    if (editingStation) {
      setDraft(stationToEditorDraft(editingStation));
      setFormError(null);
      setFormStatus(null);
      return;
    }

    setDraft(createDefaultEditorDraft());
    setFormError(null);
    setFormStatus(null);
  }, [editingStation]);

  const rulesValidation = useMemo(() => validateRuleDraft(draft.rules), [draft.rules]);

  const nameError = draft.name.trim().length === 0 ? "Station name is required" : null;
  const isFormValid = Boolean(!nameError && rulesValidation.rules);

  useEffect(() => {
    const validRules = rulesValidation.rules;

    if (!validRules) {
      setPreviewCount(null);
      setPreviewLoading(false);
      return;
    }

    const requestSeq = previewRequestSeqRef.current + 1;
    previewRequestSeqRef.current = requestSeq;

    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true);

      try {
        const result = await previewStationRules({ rules: validRules }, token);

        if (previewRequestSeqRef.current === requestSeq) {
          setPreviewCount(result.matchingTrackCount);
        }
      } catch {
        if (previewRequestSeqRef.current === requestSeq) {
          setPreviewCount(null);
        }
      } finally {
        if (previewRequestSeqRef.current === requestSeq) {
          setPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [rulesValidation.rules, token]);

  async function submit() {
    setFormError(null);
    setFormStatus(null);

    if (!rulesValidation.rules || nameError) {
      setFormError("Fix validation errors before saving.");
      return;
    }

    const payload: StationSavePayload = {
      stationId: editingStation?.id,
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      rules: rulesValidation.rules,
      isEnabled: draft.isEnabled
    };

    try {
      await onSave(payload);
      setFormStatus(editingStation ? "Station updated." : "Station created.");

      if (!editingStation) {
        setDraft(createDefaultEditorDraft());
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFormError(error.message);
        return;
      }

      setFormError(error instanceof Error ? error.message : "Failed to save station.");
    }
  }

  async function handleDelete() {
    if (!editingStation) {
      return;
    }

    setFormError(null);
    setFormStatus(null);

    try {
      await onDelete(editingStation.id);
      setFormStatus("Station deleted.");
      setDraft(createDefaultEditorDraft());
      onCancelEdit();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to delete station.");
    }
  }

  async function handleDuplicate() {
    if (!editingStation) {
      return;
    }

    setFormError(null);
    setFormStatus(null);

    try {
      await onDuplicate(editingStation);
      setFormStatus("Station duplicated.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Failed to duplicate station.");
    }
  }

  return (
    <section className="card" style={{ gridColumn: "span 4" }}>
      <h2>{editingStation ? "Edit Station" : "Create Station"}</h2>

      <div style={{ display: "grid", gap: "0.75rem" }}>
        <label>
          Name
          <input
            value={draft.name}
            onChange={(event) => {
              setDraft((prev) => ({
                ...prev,
                name: event.target.value
              }));
            }}
            required
          />
          {nameError ? <p className="error">{nameError}</p> : null}
        </label>

        <label>
          Description
          <textarea
            value={draft.description}
            onChange={(event) => {
              setDraft((prev) => ({
                ...prev,
                description: event.target.value
              }));
            }}
          />
        </label>

        <StationRuleBuilder
          token={token}
          draft={draft.rules}
          onChange={(nextRules) => {
            setDraft((prev) => ({
              ...prev,
              rules: nextRules
            }));
          }}
          errors={rulesValidation.errors}
        />

        <label>
          <input
            type="checkbox"
            checked={draft.isEnabled}
            onChange={(event) => {
              setDraft((prev) => ({
                ...prev,
                isEnabled: event.target.checked
              }));
            }}
            style={{ width: "auto", marginRight: "0.5rem" }}
          />
          Enabled
        </label>

        <div className="card" style={{ padding: "0.7rem", background: "#fff" }}>
          <strong>Matching Track Preview</strong>
          <p className="meta" style={{ marginTop: "0.35rem" }}>
            {previewLoading ? "Calculating..." : previewCount !== null ? `${previewCount} tracks` : "—"}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="primary" onClick={submit} disabled={!isFormValid || pending}>
            {pending ? "Saving..." : editingStation ? "Update Station" : "Create Station"}
          </button>

          {editingStation ? (
            <>
              <button type="button" onClick={onCancelEdit}>
                Cancel edit
              </button>
              <button type="button" onClick={handleDuplicate}>
                Duplicate Station
              </button>
              <button type="button" className="danger" onClick={handleDelete}>
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>

      {formStatus ? <p>{formStatus}</p> : null}
      {formError ? <p className="error">{formError}</p> : null}
    </section>
  );
}

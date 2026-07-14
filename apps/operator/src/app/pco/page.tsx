"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ItemPreview,
  PcoPlan,
  PcoPlanItem,
  PcoServiceType,
} from "@overlaysys/core";
import {
  Button,
  Field,
  Panel,
  Pill,
  Select,
  Stack,
  Table,
  Td,
  Th,
  Tr,
  colors,
} from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { getDesktopApi } from "@/lib/desktop";
import { useStore } from "@/lib/store";
import {
  getPcoStatus,
  getPlanItems,
  importPlan,
  listPlans,
  listServiceTypes,
  setPcoCredentials,
  type ImportPlanResult,
} from "@/lib/pcoClient";

type Status = "checking" | "disconnected" | "connected";
type SongAction = "link" | "create";

function planLabel(p: PcoPlan): string {
  return p.dates || p.title || p.sortDate || p.id;
}

export default function PcoPage() {
  const templates = useStore((s) => s.templates);
  const allShowMetas = useStore((s) => s.showMetas);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const showMetas = allShowMetas.filter((s) => s.projectId === currentProjectId);

  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  const [serviceTypes, setServiceTypes] = useState<PcoServiceType[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [plans, setPlans] = useState<PcoPlan[]>([]);
  const [planId, setPlanId] = useState("");

  const [items, setItems] = useState<PcoPlanItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, ItemPreview>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, SongAction>>({});
  const [loadingItems, setLoadingItems] = useState(false);

  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState("");
  const [existingShowId, setExistingShowId] = useState("");
  const [lyricTemplateId, setLyricTemplateId] = useState("");
  const [graphicTemplateId, setGraphicTemplateId] = useState("");

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportPlanResult | null>(null);

  // "For now use an access token" path: a Personal Access Token (App ID +
  // Secret) entered directly, bypassing the OAuth flow.
  const [patAppId, setPatAppId] = useState("");
  const [patSecret, setPatSecret] = useState("");
  const [connectingPat, setConnectingPat] = useState(false);

  // Default template selections once the store's templates arrive.
  useEffect(() => {
    if (!lyricTemplateId && templates[0]) setLyricTemplateId(templates[0].id);
    if (!graphicTemplateId && templates[0]) setGraphicTemplateId(templates[0].id);
  }, [templates, lyricTemplateId, graphicTemplateId]);

  const loadServiceTypes = useCallback(async () => {
    try {
      setServiceTypes(await listServiceTypes());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const s = await getPcoStatus();
      setStatus(s.connected ? "connected" : "disconnected");
      if (s.connected) void loadServiceTypes();
    } catch {
      setStatus("disconnected");
    }
  }, [loadServiceTypes]);

  useEffect(() => {
    void checkStatus();
    const api = getDesktopApi();
    const offIn = api?.onPcoSignedIn?.(() => void checkStatus());
    const offOut = api?.onPcoSignedOut?.(() => setStatus("disconnected"));
    return () => {
      offIn?.();
      offOut?.();
    };
  }, [checkStatus]);

  async function signIn() {
    setError(null);
    const api = getDesktopApi();
    if (!api?.pcoSignIn) {
      setError("Open the OverlaySys desktop app to connect Planning Center.");
      return;
    }
    const res = await api.pcoSignIn();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Give the desktop a moment to push the token to the server.
    setTimeout(() => void checkStatus(), 600);
  }

  async function connectWithPat() {
    setError(null);
    if (!patAppId.trim() || !patSecret.trim()) {
      setError("Enter both the Application ID and Secret.");
      return;
    }
    setConnectingPat(true);
    try {
      await setPcoCredentials({ appId: patAppId.trim(), secret: patSecret.trim() });
      setPatSecret("");
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingPat(false);
    }
  }

  async function onPickServiceType(id: string) {
    setServiceTypeId(id);
    setPlans([]);
    setPlanId("");
    setItems([]);
    if (!id) return;
    try {
      setPlans(await listPlans(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onPickPlan(id: string) {
    setPlanId(id);
    setItems([]);
    setResult(null);
    if (!id) return;
    setLoadingItems(true);
    setError(null);
    try {
      const { items: fetched, previews: pv } = await getPlanItems(serviceTypeId, id);
      setItems(fetched);
      const map: Record<string, ItemPreview> = {};
      const dec: Record<string, SongAction> = {};
      for (const p of pv) {
        map[p.itemId] = p;
        if (p.itemType === "song") dec[p.itemId] = p.match ? "link" : "create";
      }
      setPreviews(map);
      setDecisions(dec);
      setSelected(new Set(fetched.map((i) => i.id)));
      const plan = plans.find((p) => p.id === id);
      if (plan) setNewName(planLabel(plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingItems(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canImport = useMemo(() => {
    if (selected.size === 0 || importing) return false;
    if (targetMode === "existing" && !existingShowId) return false;
    return true;
  }, [selected, importing, targetMode, existingShowId]);

  async function doImport() {
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const songDecisions: Record<string, { action: SongAction; songId?: string }> = {};
      for (const id of selected) {
        const pv = previews[id];
        if (pv?.itemType !== "song") continue;
        const action = decisions[id] ?? (pv.match ? "link" : "create");
        songDecisions[id] =
          action === "link" && pv.match
            ? { action: "link", songId: pv.match.songId }
            : { action: "create" };
      }
      const res = await importPlan({
        serviceTypeId,
        planId,
        planTitle: newName,
        target:
          targetMode === "new"
            ? { mode: "new", name: newName, projectId: currentProjectId }
            : { mode: "existing", showId: existingShowId },
        lyricTemplateId,
        graphicTemplateId,
        selectedItemIds: [...selected],
        songDecisions,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <PageChrome title="Planning Center" />
      <PageBody maxWidth={1000} style={{ height: "100%" }}>
        {status === "checking" && <p style={{ color: colors.textDim }}>Checking connection…</p>}

        {status === "disconnected" && (
          <Panel title="Connect to Planning Center">
            <Stack gap={3}>
              <p style={{ color: colors.textDim }}>
                Import service plans from Planning Center into OverlaySys.
              </p>

              <div>
                <div style={{ color: colors.textDim, fontSize: 13, marginBottom: 6 }}>
                  Personal Access Token (recommended for now)
                </div>
                <Stack gap={2}>
                  <Field
                    label="Application ID"
                    hint="The first value of your Personal Access Token (PCO may label it “Client ID”)."
                  >
                    <input
                      value={patAppId}
                      onChange={(e) => setPatAppId(e.target.value)}
                      autoComplete="off"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Secret">
                    <input
                      type="password"
                      value={patSecret}
                      onChange={(e) => setPatSecret(e.target.value)}
                      autoComplete="off"
                      style={inputStyle}
                    />
                  </Field>
                  <div>
                    <Button
                      variant="primary"
                      disabled={connectingPat}
                      onClick={() => void connectWithPat()}
                    >
                      {connectingPat ? "Connecting…" : "Connect"}
                    </Button>
                  </div>
                  <p style={{ color: colors.textDim, fontSize: 12 }}>
                    Create one at api.planningcenteronline.com → Developer → Personal
                    Access Tokens. Both values are required (used as HTTP Basic auth).
                  </p>
                </Stack>
              </div>

              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                <div style={{ color: colors.textDim, fontSize: 13, marginBottom: 6 }}>
                  Or sign in with OAuth (desktop app)
                </div>
                <Button variant="secondary" onClick={() => void signIn()}>
                  Sign in with Planning Center
                </Button>
              </div>

              {error && <p style={{ color: colors.errorText }}>{error}</p>}
            </Stack>
          </Panel>
        )}

        {status === "connected" && (
          <Stack gap={4}>
            <Panel title="Select a plan">
              <Stack gap={3}>
                <Field label="Service type">
                  <Select
                    value={serviceTypeId}
                    onChange={(e) => void onPickServiceType(e.target.value)}
                  >
                    <option value="">— choose —</option>
                    {serviceTypes.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Plan">
                  <Select
                    value={planId}
                    onChange={(e) => void onPickPlan(e.target.value)}
                    disabled={plans.length === 0}
                  >
                    <option value="">— choose —</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {planLabel(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Stack>
            </Panel>

            {loadingItems && <p style={{ color: colors.textDim }}>Loading plan items…</p>}

            {items.length > 0 && (
              <Panel title={`Items (${selected.size}/${items.length} selected)`}>
                <Table size="sm" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <Th style={{ width: 32 }} />
                      <Th>Item</Th>
                      <Th style={{ width: 80 }}>Type</Th>
                      <Th style={{ width: 280 }}>Import as</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const pv = previews[item.id];
                      const isSong = item.itemType === "song";
                      const checked = selected.has(item.id);
                      return (
                        <Tr key={item.id} selected={checked}>
                          <Td>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(item.id)}
                            />
                          </Td>
                          <Td>{item.title}</Td>
                          <Td>
                            <Pill tone={isSong ? "accent" : "dim"} uppercase>
                              {item.itemType}
                            </Pill>
                          </Td>
                          <Td>
                            {isSong ? (
                              <SongDecisionCell
                                preview={pv}
                                value={decisions[item.id] ?? (pv?.match ? "link" : "create")}
                                onChange={(a) =>
                                  setDecisions((d) => ({ ...d, [item.id]: a }))
                                }
                              />
                            ) : (
                              <span style={{ color: colors.textDim }}>Graphic row</span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Panel>
            )}

            {items.length > 0 && (
              <Panel title="Import target">
                <Stack gap={3}>
                  <Field label="Destination">
                    <Select
                      value={targetMode}
                      onChange={(e) => setTargetMode(e.target.value as "new" | "existing")}
                    >
                      <option value="new">Create a new show</option>
                      <option value="existing">Add to an existing show</option>
                    </Select>
                  </Field>
                  {targetMode === "new" ? (
                    <Field label="New show name">
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        style={inputStyle}
                      />
                    </Field>
                  ) : (
                    <Field label="Existing show">
                      <Select
                        value={existingShowId}
                        onChange={(e) => setExistingShowId(e.target.value)}
                      >
                        <option value="">— choose —</option>
                        {showMetas.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label="Lyric template (songs)">
                    <Select
                      value={lyricTemplateId}
                      onChange={(e) => setLyricTemplateId(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Graphic template (headers/media)">
                    <Select
                      value={graphicTemplateId}
                      onChange={(e) => setGraphicTemplateId(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div>
                    <Button
                      variant="primary"
                      disabled={!canImport}
                      onClick={() => void doImport()}
                    >
                      {importing ? "Importing…" : `Import ${selected.size} item(s)`}
                    </Button>
                  </div>
                </Stack>
              </Panel>
            )}

            {error && <p style={{ color: colors.errorText }}>{error}</p>}

            {result && (
              <Panel title={result.ok ? "Import complete" : "Import finished with errors"}>
                <Stack gap={2}>
                  <p style={{ color: colors.text }}>
                    {result.counts.rows} row(s) · {result.counts.songsCreated} song(s) created ·{" "}
                    {result.counts.songsLinked} linked · {result.counts.songsUpdated} updated
                  </p>
                  {result.warnings.map((w, i) => (
                    <p key={i} style={{ color: colors.textDim, fontSize: 13 }}>
                      ⚠ {w}
                    </p>
                  ))}
                  {result.errors.map((e, i) => (
                    <p key={i} style={{ color: colors.errorText, fontSize: 13 }}>
                      {e.itemId}: {e.message}
                    </p>
                  ))}
                </Stack>
              </Panel>
            )}
          </Stack>
        )}
      </PageBody>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  background: colors.panel2,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  color: colors.text,
  fontSize: 13,
  boxSizing: "border-box",
};

function SongDecisionCell({
  preview,
  value,
  onChange,
}: {
  preview: ItemPreview | undefined;
  value: SongAction;
  onChange: (a: SongAction) => void;
}) {
  const hasMatch = !!preview?.match;
  return (
    <Stack gap={1}>
      <Select value={value} onChange={(e) => onChange(e.target.value as SongAction)}>
        {hasMatch && (
          <option value="link">Link to “{preview!.match!.title}”</option>
        )}
        <option value="create">Create new song</option>
      </Select>
      {value === "create" && preview && preview.hasLyrics === false && (
        <span style={{ color: colors.textDim, fontSize: 12 }}>No lyrics in arrangement</span>
      )}
      {hasMatch && (
        <span style={{ color: colors.textDim, fontSize: 12 }}>
          match: {preview!.match!.confidence}
        </span>
      )}
    </Stack>
  );
}

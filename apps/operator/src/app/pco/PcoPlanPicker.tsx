"use client";

import type { PcoPlan, PcoServiceType } from "@overlaysys/core";
import { Field, Select, Stack } from "@overlaysys/ui";

export function planLabel(p: PcoPlan): string {
  return p.dates || p.title || p.sortDate || p.id;
}

export function PcoPlanPicker({
  serviceTypes,
  serviceTypeId,
  plans,
  plansLoading,
  planId,
  onPickServiceType,
  onPickPlan,
}: {
  serviceTypes: PcoServiceType[];
  serviceTypeId: string;
  plans: PcoPlan[];
  plansLoading: boolean;
  planId: string;
  onPickServiceType: (id: string) => void;
  onPickPlan: (id: string) => void;
}) {
  const noPlans = !!serviceTypeId && !plansLoading && plans.length === 0;
  return (
    <Stack gap={3}>
      <Field label="Service type">
        <Select value={serviceTypeId} onChange={(e) => onPickServiceType(e.target.value)}>
          <option value="">Choose a service type</option>
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
          onChange={(e) => onPickPlan(e.target.value)}
          disabled={plans.length === 0}
        >
          <option value="">
            {plansLoading ? "Loading plans…" : noPlans ? "No upcoming plans" : "Choose a plan"}
          </option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {planLabel(p)}
            </option>
          ))}
        </Select>
      </Field>
    </Stack>
  );
}

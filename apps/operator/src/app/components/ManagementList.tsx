"use client";

import type { ReactNode } from "react";
import { Button, EntityList, EntityRow, IconButton, colors } from "@overlaysys/ui";
import { useDialog } from "@/lib/dialog";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";

export interface ManagementListProps<T> {
  /** Plural page title rendered in the shell top bar, e.g. "Songs". */
  title: string;
  /**
   * Singular noun used for the create button ("+ New {Noun}") and dialog
   * copy ("Delete {noun}?"). The wrapper capitalizes the first letter for
   * the button; pass it lowercase.
   */
  entityNoun: string;
  /** Optional context shown next to the title in the sub-header (e.g. "in Sunday Service" for project-scoped lists). */
  context?: ReactNode;
  items: T[];

  /**
   * Additional header actions rendered before the standardized "+ New"
   * button — e.g. "Import from file…" for Songs.
   */
  secondaryActions?: ReactNode;

  /**
   * Disables create + per-row standardized delete. Useful when the WS
   * connection is closed in local mode.
   */
  disabled?: boolean;

  /**
   * Create a new entity. The wrapper prompts the user for a name and calls
   * this with the trimmed value. Resolve with the new entity's id so the
   * wrapper can route via `onCreated`.
   */
  createFn: (name: string) => Promise<string>;
  /** Called after `createFn` resolves — typically navigates to the editor. */
  onCreated?: (id: string) => void;

  /** Delete the entity. Wrapper handles the confirm dialog. */
  deleteFn: (item: T) => Promise<void>;

  // --- Row config ---
  rowKey: (item: T) => string;
  rowHref?: (item: T) => string;
  rowPrimary: (item: T) => ReactNode;
  rowSecondary?: (item: T) => ReactNode;
  /** Per-row actions rendered before the standardized delete (×) button. */
  rowActions?: (item: T) => ReactNode;
  /** Display name for confirm copy ("Delete {name}?"). Defaults to rowKey. */
  itemDisplayName?: (item: T) => string;

  /** Empty-state message override. Defaults to "No {entityNoun}s yet. …" */
  emptyMessage?: ReactNode;

  /** Body container max width (matches existing per-page pattern). Default 720. */
  maxWidth?: number;

  /**
   * Optional content rendered inside PageBody but above the list — used by
   * pages that need a sticky banner or sync UI that the wrapper itself
   * doesn't model (e.g. Projects' cloud publish/pull row).
   */
  bodyHeader?: ReactNode;

  /**
   * Predicate gating whether the standardized delete (×) button shows for a
   * given item. Returns true for everything by default. Used by Projects to
   * suppress delete on the seeded default project.
   */
  canDelete?: (item: T) => boolean;

  /**
   * Title for the disabled delete button when `canDelete` returns false —
   * surfaced as the `title` attribute so the user sees a tooltip explaining
   * why deletion is blocked.
   */
  cannotDeleteReason?: (item: T) => string;

  /**
   * Optional extra content appended to the standard delete-confirm message
   * (after "Delete <name>? This cannot be undone."). Used by Projects to
   * warn about orphaned shows/hotcards before destructive confirm.
   */
  deleteConfirmDetails?: (item: T) => ReactNode;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Standardized wrapper for the four management list pages (Shows, Projects,
 * Songs, Templates). Owns the page chrome (PageChrome title + "+ New"
 * button + PageBody) and the create / delete flows so every list
 * uses the same name-first prompt and confirm dialog. Per-entity quirks
 * (different secondary actions, custom row content, navigation targets) are
 * supplied via props.
 */
export function ManagementList<T>({
  title,
  entityNoun,
  context,
  items,
  secondaryActions,
  disabled,
  createFn,
  onCreated,
  deleteFn,
  rowKey,
  rowHref,
  rowPrimary,
  rowSecondary,
  rowActions,
  itemDisplayName,
  emptyMessage,
  maxWidth = 720,
  bodyHeader,
  canDelete,
  cannotDeleteReason,
  deleteConfirmDetails,
}: ManagementListProps<T>) {
  const { prompt, confirm, alert, dialog } = useDialog();

  async function handleCreate() {
    const name = await prompt({
      title: `New ${entityNoun}`,
      message: `Name this ${entityNoun}:`,
      placeholder: `${capitalize(entityNoun)} name`,
      confirmLabel: "Create",
    });
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const id = await createFn(trimmed);
      onCreated?.(id);
    } catch (err) {
      await alert({
        title: `Create ${entityNoun} failed`,
        message: err instanceof Error ? err.message : JSON.stringify(err),
      });
    }
  }

  async function handleDelete(item: T) {
    const name = itemDisplayName ? itemDisplayName(item) : rowKey(item);
    const details = deleteConfirmDetails?.(item);
    const ok = await confirm({
      title: `Delete ${entityNoun}`,
      message: (
        <>
          Delete <strong>{name}</strong>? This cannot be undone.
          {details && (
            <>
              <br />
              {details}
            </>
          )}
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFn(item);
    } catch (err) {
      await alert({
        title: `Delete ${entityNoun} failed`,
        message: err instanceof Error ? err.message : JSON.stringify(err),
      });
    }
  }

  return (
    <>
      <PageChrome
        title={title}
        context={context}
        actions={
          <>
            {secondaryActions}
            <Button
              onClick={handleCreate}
              variant="primary"
              size="sm"
              disabled={disabled}
            >
              + New {capitalize(entityNoun)}
            </Button>
          </>
        }
      />
      <PageBody maxWidth={maxWidth} style={{ height: "100%" }}>
        {bodyHeader}
        {items.length === 0 ? (
          <p style={{ color: colors.textDim, fontSize: 13 }}>
            {emptyMessage ?? `No ${entityNoun}s yet. Create one to get started.`}
          </p>
        ) : (
          <EntityList>
            {items.map((item) => {
              const deletable = canDelete ? canDelete(item) : true;
              const blockedReason = !deletable
                ? cannotDeleteReason?.(item) ?? `This ${entityNoun} can't be deleted`
                : null;
              return (
                <EntityRow
                  key={rowKey(item)}
                  href={rowHref?.(item)}
                  primary={rowPrimary(item)}
                  secondary={rowSecondary?.(item)}
                  actions={
                    <>
                      {rowActions?.(item)}
                      <IconButton
                        onClick={() => handleDelete(item)}
                        title={blockedReason ?? `Delete ${entityNoun}`}
                        size={44}
                        style={{
                          color: deletable ? colors.red : colors.textDim,
                          fontSize: 16,
                          borderRadius: 6,
                        }}
                        disabled={disabled || !deletable}
                      >
                        ×
                      </IconButton>
                    </>
                  }
                />
              );
            })}
          </EntityList>
        )}
      </PageBody>
      {dialog}
    </>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Check, LayoutGrid, List, MoreHorizontal, Plus, Search, WifiOff, ArrowDownUp } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { KindBar } from "./KindBar";
import { useContextMenu } from "./Menu";
import { isContextMenuKey, type MenuItem } from "./menuModel";
import { SegmentedControl } from "./SegmentedControl";
import { Select } from "./Select";
import { Tooltip } from "./Tooltip";
import {
  computeVisible,
  listBodyState,
  loadListPrefs,
  moveSelection,
  saveListPrefs,
  shouldFocusSearch,
  type FilterSpec,
  type ListPrefs,
  type ListView,
  type SortSpec,
} from "./libraryListModel";
import { colors, fontSize, fontWeight, radius, type ItemKind } from "./tokens";

export type { SortSpec, FilterSpec } from "./libraryListModel";

export type Column<T> = {
  id: string;
  label: string;
  width?: string;
  render(item: T): ReactNode;
  align?: "left" | "right";
};

export type LibraryListProps<T> = {
  items: T[];
  getId(item: T): string;
  /** Name (line 1). */
  primary(item: T): ReactNode;
  /** Muted line 2 (never an id). */
  secondary?(item: T): ReactNode;
  /** KindBar colour. */
  kind?(item: T): ItemKind;
  columns?: Column<T>[];
  /** Haystack for search. */
  searchText(item: T): string;
  sorts: SortSpec<T>[];
  /** SortSpec id. */
  defaultSort: string;
  filters?: FilterSpec<T>[];
  /** Context menu + "more" button. */
  menuItems(item: T): MenuItem[];
  /** Click / Enter. */
  onOpen(item: T): void;
  primaryAction?: { label: string; onClick(): void; disabledReason?: string };
  /** Secondary page actions, left of the primary action. */
  headerActions?: ReactNode;
  /** Enables the list/grid toggle. */
  views?: { grid?: { renderCard(item: T): ReactNode; minCardWidth?: number } };
  /** Persists sort/filter/view per page. */
  storageKey: string;
  emptyState: { title: string; body?: string; action?: { label: string; onClick(): void } };
  loading?: boolean;
  error?: string | null;
};

const ROW_H = 44;
const COL_GAP = 12;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const ellipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

function titleOf(node: ReactNode): string | undefined {
  return typeof node === "string" || typeof node === "number" ? String(node) : undefined;
}

/**
 * Shared full-width library list: search, sort, filters, list/grid view,
 * right-click and "more" menus, keyboard navigation. Every list page uses it.
 */
export function LibraryList<T>(props: LibraryListProps<T>) {
  const {
    items,
    getId,
    primary,
    secondary,
    kind,
    columns = [],
    searchText,
    sorts,
    defaultSort,
    filters,
    menuItems,
    onOpen,
    primaryAction,
    headerActions,
    views,
    storageKey,
    emptyState,
    loading,
    error,
  } = props;

  const gridSpec = views?.grid;
  const [query, setQuery] = useState("");
  const [prefs, setPrefs] = useState<ListPrefs>({ sort: defaultSort, filters: {}, view: "list" });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const { open: openMenu, menu } = useContextMenu();

  const sortIdsKey = sorts.map((s) => s.id).join("|");
  // Load after mount (SSR-safe), then persist every change.
  useEffect(() => {
    setPrefs(
      loadListPrefs(safeStorage(), storageKey, {
        sortIds: sortIdsKey.split("|"),
        defaultSort,
        filters: filters as FilterSpec<unknown>[] | undefined,
        gridAvailable: !!gridSpec,
      }),
    );
    setPrefsLoaded(true);
    // Filters/grid are page constants; reload only when the page identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, sortIdsKey, defaultSort]);

  useEffect(() => {
    if (prefsLoaded) saveListPrefs(safeStorage(), storageKey, prefs);
  }, [prefs, prefsLoaded, storageKey]);

  const view: ListView = prefs.view === "grid" && gridSpec ? "grid" : "list";

  const visible = useMemo(
    () =>
      computeVisible({
        items,
        query,
        searchText,
        sorts,
        sortId: prefs.sort,
        filters,
        filterValues: prefs.filters,
      }),
    [items, query, searchText, sorts, prefs.sort, filters, prefs.filters],
  );
  const visibleIds = useMemo(() => visible.map(getId), [visible, getId]);
  const state = listBodyState({ loading, error, total: items.length, visible: visible.length });
  const selectedVisible = selected !== null && visibleIds.includes(selected) ? selected : null;
  const tabStop = selectedVisible ?? visibleIds[0] ?? null;

  const focusItem = useCallback((id: string | null) => {
    if (id) itemRefs.current.get(id)?.focus();
  }, []);

  const openItemMenu = (item: T, target: ReactMouseEvent | HTMLElement) => {
    setSelected(getId(item));
    openMenu(target, menuItems(item));
  };

  const currentSort = sorts.find((s) => s.id === prefs.sort) ?? sorts[0];
  const openSortMenu = (e: ReactMouseEvent<HTMLElement>) => {
    openMenu(
      e.currentTarget,
      sorts.map<MenuItem>((s) => ({
        id: s.id,
        label: s.label,
        icon: s.id === currentSort?.id ? <Check size={14} /> : <span />,
        onSelect: () => setPrefs((p) => ({ ...p, sort: s.id })),
      })),
    );
  };

  /** Cards per grid row, read from layout (cards sharing the first card's top). */
  const gridColumns = () => {
    const first = visibleIds[0] ? itemRefs.current.get(visibleIds[0]) : undefined;
    if (!first) return 1;
    let n = 0;
    for (const id of visibleIds) {
      if (itemRefs.current.get(id)?.offsetTop !== first.offsetTop) break;
      n++;
    }
    return Math.max(1, n);
  };

  const onListKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest("button")) {
      // Let the "more" button handle its own Enter/Space.
      if (e.key === "Enter" || e.key === " ") return;
    }
    let steps = 0;
    let dir: 1 | -1 = 1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      steps = view === "grid" ? gridColumns() : 1;
      dir = e.key === "ArrowDown" ? 1 : -1;
    } else if (view === "grid" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      steps = 1;
      dir = e.key === "ArrowRight" ? 1 : -1;
    }
    if (steps > 0) {
      e.preventDefault();
      let next = selectedVisible;
      for (let i = 0; i < steps; i++) next = moveSelection(visibleIds, next, dir);
      setSelected(next);
      focusItem(next);
      return;
    }
    const item = selectedVisible ? visible[visibleIds.indexOf(selectedVisible)] : undefined;
    if (!item || !selectedVisible) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(item);
    } else if (isContextMenuKey(e)) {
      e.preventDefault();
      const el = itemRefs.current.get(selectedVisible);
      if (el) openItemMenu(item, el);
    }
  };

  const onRootKeyDown = (e: ReactKeyboardEvent) => {
    const t = e.target as HTMLElement;
    // Portal children (the menu) bubble here through the React tree; ignore them.
    if (!(e.currentTarget as HTMLElement).contains(t)) return;
    if (
      shouldFocusSearch({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: t.tagName ?? "",
        targetEditable: !!t.isContentEditable,
      })
    ) {
      e.preventDefault();
      setQuery((q) => q + e.key);
      searchBoxRef.current?.querySelector("input")?.focus();
    }
  };

  const createDisabledReason = primaryAction?.disabledReason ?? (error ? error : undefined);

  const moreButton = (item: T, label: string) => (
    <IconButton
      aria-label={`More actions for ${label}`}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        openItemMenu(item, e);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <MoreHorizontal size={14} aria-hidden />
    </IconButton>
  );

  const itemHandlers = (item: T, id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
    role: "option" as const,
    "aria-selected": id === selectedVisible,
    tabIndex: id === tabStop ? 0 : -1,
    onClick: () => {
      setSelected(id);
      onOpen(item);
    },
    onFocus: () => setSelected(id),
    onContextMenu: (e: ReactMouseEvent) => openItemMenu(item, e),
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
  });

  const hasKind = !!kind;
  const template = [
    hasKind ? "3px" : null,
    "minmax(220px, 1fr)",
    ...columns.map((c) => c.width ?? "120px"),
    "32px",
  ]
    .filter(Boolean)
    .join(" ");
  const rowGrid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: template,
    columnGap: COL_GAP,
    alignItems: "center",
    padding: hasKind ? "0 8px 0 6px" : "0 8px 0 12px",
  };

  const filterActive = Object.values(prefs.filters).some((v) => v && v !== "all");

  let body: ReactNode;
  if (state === "loading") {
    body = (
      <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{ height: ROW_H, borderRadius: radius.md, background: colors.surface2, opacity: 1 - i * 0.25 }}
          />
        ))}
      </div>
    );
  } else if (state === "error") {
    body = (
      <div role="status" style={centerBox}>
        <WifiOff size={20} aria-hidden style={{ color: colors.textMuted }} />
        <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text }}>{error}</div>
      </div>
    );
  } else if (state === "empty") {
    body = (
      <div style={centerBox}>
        <div style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text }}>
          {emptyState.title}
        </div>
        {emptyState.body ? (
          <div style={{ fontSize: fontSize.sm, color: colors.textDim, maxWidth: 420 }}>{emptyState.body}</div>
        ) : null}
        {emptyState.action ? (
          <Button variant="secondary" size="md" onClick={emptyState.action.onClick} style={{ marginTop: 4 }}>
            {emptyState.action.label}
          </Button>
        ) : null}
      </div>
    );
  } else if (state === "no-match") {
    body = (
      <div role="status" style={centerBox}>
        <div style={{ fontSize: fontSize.md, color: colors.textDim }}>
          {query.trim() ? `No results for “${query.trim()}”` : "No results match these filters"}
        </div>
        {query.trim() ? (
          <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
            Clear search
          </Button>
        ) : filterActive ? (
          <Button variant="ghost" size="sm" onClick={() => setPrefs((p) => ({ ...p, filters: {} }))}>
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  } else if (view === "grid" && gridSpec) {
    body = (
      <div
        role="listbox"
        aria-label="Items"
        onKeyDown={onListKeyDown}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${gridSpec.minCardWidth ?? 220}px, 1fr))`,
          gap: 12,
        }}
      >
        {visible.map((item) => {
          const id = getId(item);
          const name = primary(item);
          const nameText = titleOf(name);
          const isSel = id === selectedVisible;
          return (
            <div
              key={id}
              {...itemHandlers(item, id)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 6,
                minWidth: 0,
                borderRadius: radius.lg,
                border: `1px solid ${colors.border}`,
                background: isSel ? colors.surface3 : hovered === id ? colors.surface2 : colors.surface,
                boxShadow: isSel ? `0 0 0 2px ${colors.brand}` : undefined,
                cursor: "pointer",
                outline: "none",
              }}
            >
              <div style={{ minWidth: 0 }}>{gridSpec.renderCard(item)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {kind ? (
                  <span style={{ display: "flex", alignSelf: "stretch" }}>
                    <KindBar kind={kind(item)} />
                  </span>
                ) : null}
                <span
                  title={nameText}
                  style={{ ...ellipsis, flex: 1, fontSize: fontSize.md, color: colors.text }}
                >
                  {name}
                </span>
                {moreButton(item, nameText ?? "this item")}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else {
    body = (
      <div>
        <div
          aria-hidden
          style={{
            ...rowGrid,
            height: 24,
            fontSize: fontSize.xs,
            color: colors.textMuted,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          {hasKind ? <span /> : null}
          <span style={ellipsis}>Name</span>
          {columns.map((c) => (
            <span key={c.id} style={{ ...ellipsis, textAlign: c.align ?? "left" }}>
              {c.label}
            </span>
          ))}
          <span />
        </div>
        <div role="listbox" aria-label="Items" onKeyDown={onListKeyDown}>
          {visible.map((item) => {
            const id = getId(item);
            const name = primary(item);
            const nameText = titleOf(name);
            const sub = secondary?.(item);
            const isSel = id === selectedVisible;
            return (
              <div
                key={id}
                {...itemHandlers(item, id)}
                style={{
                  ...rowGrid,
                  height: ROW_H,
                  borderBottom: `1px solid ${colors.border}`,
                  background: isSel ? colors.surface3 : hovered === id ? colors.surface2 : "transparent",
                  boxShadow: isSel ? `inset 2px 0 0 ${colors.brand}` : undefined,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {kind ? (
                  <span style={{ display: "flex", height: 28 }}>
                    <KindBar kind={kind(item)} />
                  </span>
                ) : null}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span title={nameText} style={{ ...ellipsis, fontSize: fontSize.md, color: colors.text }}>
                    {name}
                  </span>
                  {sub != null && sub !== "" ? (
                    <span title={titleOf(sub)} style={{ ...ellipsis, fontSize: fontSize.xs, color: colors.textMuted }}>
                      {sub}
                    </span>
                  ) : null}
                </div>
                {columns.map((c) => {
                  const v = c.render(item);
                  return (
                    <span
                      key={c.id}
                      title={titleOf(v)}
                      style={{ ...ellipsis, fontSize: fontSize.sm, color: colors.textDim, textAlign: c.align ?? "left" }}
                    >
                      {v}
                    </span>
                  );
                })}
                {moreButton(item, nameText ?? "this item")}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const primaryButton = primaryAction ? (
    <Button
      variant="primary"
      size="md"
      icon={<Plus size={14} />}
      disabled={!!createDisabledReason}
      onClick={primaryAction.onClick}
      // A disabled button swallows pointer events; let the wrapper get them for the tooltip.
      style={createDisabledReason ? { pointerEvents: "none" } : undefined}
    >
      {primaryAction.label}
    </Button>
  ) : null;

  return (
    <div
      onKeyDown={onRootKeyDown}
      style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", minWidth: 0 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36, minWidth: 0 }}>
        <div ref={searchBoxRef} style={{ position: "relative", flex: "1 1 200px", maxWidth: 360, minWidth: 140 }}>
          <Search
            size={14}
            aria-hidden
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: colors.textMuted,
              pointerEvents: "none",
            }}
          />
          <Input
            size="md"
            type="text"
            role="searchbox"
            placeholder="Search"
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              } else if (e.key === "ArrowDown" && visibleIds.length > 0) {
                e.preventDefault();
                const next = selectedVisible ?? visibleIds[0]!;
                setSelected(next);
                focusItem(next);
              }
            }}
            style={{ paddingLeft: 28 }}
          />
        </div>
        {filters?.map((f) => (
          <Select
            key={f.id}
            size="md"
            aria-label={f.label}
            value={prefs.filters[f.id] ?? "all"}
            onChange={(e) => {
              const v = e.target.value;
              setPrefs((p) => {
                const next = { ...p.filters };
                if (v === "all" || v === "") delete next[f.id];
                else next[f.id] = v;
                return { ...p, filters: next };
              });
            }}
            style={{ width: "auto", maxWidth: 200 }}
          >
            <option value="all">All {f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ))}
        {sorts.length > 0 ? (
          <Button
            variant="secondary"
            size="md"
            icon={<ArrowDownUp size={14} />}
            aria-haspopup="menu"
            onClick={openSortMenu}
          >
            Sort: {currentSort?.label}
          </Button>
        ) : null}
        {gridSpec ? (
          <SegmentedControl<ListView>
            aria-label="View"
            value={view}
            onChange={(v) => setPrefs((p) => ({ ...p, view: v }))}
            options={[
              { value: "list", label: <List size={14} aria-hidden />, title: "List" },
              { value: "grid", label: <LayoutGrid size={14} aria-hidden />, title: "Grid" },
            ]}
          />
        ) : null}
        <div style={{ flex: 1 }} />
        {headerActions}
        {primaryButton && createDisabledReason ? (
          <Tooltip content={createDisabledReason} side="bottom">
            <span tabIndex={0} style={{ display: "inline-flex", borderRadius: radius.md, outline: "none" }}>
              {primaryButton}
            </span>
          </Tooltip>
        ) : (
          primaryButton
        )}
      </div>
      {body}
      {menu}
    </div>
  );
}

const centerBox: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "48px 16px",
  textAlign: "center",
  border: `1px dashed ${colors.border}`,
  borderRadius: radius.lg,
};

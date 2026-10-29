"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Deck, DeckMeta } from "@overlaysys/core";
import { LibraryList, offlineCopy, useConfirm, usePrompt, useToast } from "@overlaysys/ui";
import { useStore } from "../../lib/store";
import { getClient } from "../../lib/useWs";
import { useConnection } from "../../lib/useConnection";
import { ackErrorText, requestOne, sendAndAwaitAck } from "../../lib/awaitAck";
import { plural } from "../../lib/listFormat";
import { PageBody } from "../components/PageShell";
import { PageChrome } from "../shell/PageChrome";
import { NewDeckDialog } from "./NewDeckDialog";
import {
  DECK_LIST_STORAGE_KEY,
  DEFAULT_DECK_SORT,
  deckColumns,
  deckDeleteConfirm,
  deckFilters,
  deckMenuItems,
  deckSorts,
  type DeckActions,
} from "./libraryConfig";

const editHref = (id: string) => `/slides/edit?id=${encodeURIComponent(id)}`;
const searchText = (d: DeckMeta) => [d.name, ...d.tags].join(" ");

/** The full deck: from the cache, else asked of the server. */
async function loadDeck(id: string): Promise<Deck> {
  const cached = useStore.getState().deckCache[id];
  if (cached) return cached;
  return requestOne(getClient(), { type: "get_deck", deckId: id }, (m) =>
    m.type === "deck" && m.deck.id === id ? m.deck : undefined,
  );
}

export default function SlidesLibraryPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { connected } = useConnection();
  const decks = useStore((s) => s.decks);
  const [listed, setListed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  // Ask for the list on (re)connect; the first deck_list ends the loading state.
  useEffect(() => {
    if (!connected) return;
    const client = getClient();
    const off = client.on((m) => {
      if (m.type === "deck_list") setListed(true);
    });
    client.send({ type: "list_decks" });
    return off;
  }, [connected]);

  const filters = useMemo(() => deckFilters(decks), [decks]);
  // Remount when the tag set changes so saved tag-filter prefs are re-validated against it.
  const tagKey = filters.find((f) => f.id === "tag")?.options.map((o) => o.value).join("\u0000") ?? "";

  const failed = (e: unknown) => toast({ tone: "error", message: `Not saved: ${ackErrorText(e)}` });

  const actions: DeckActions = {
    open: (d) => router.push(editHref(d.id)),
    duplicate: async (d) => {
      try {
        await requestOne(getClient(), { type: "duplicate_deck", deckId: d.id }, (m) =>
          m.type === "ack" && m.op === "duplicate_deck" ? m.id : undefined,
        );
        toast({ tone: "ok", message: "Deck duplicated" });
      } catch (e) {
        failed(e);
      }
    },
    rename: async (d) => {
      const name = await prompt({
        title: "Rename deck",
        defaultValue: d.name,
        confirmLabel: "Rename",
        required: true,
      });
      const next = name?.trim();
      if (!next || next === d.name) return;
      try {
        const deck = await loadDeck(d.id);
        await sendAndAwaitAck(getClient(), { type: "save_deck", deck: { ...deck, name: next } }, { op: "save_deck", id: d.id });
      } catch (e) {
        failed(e);
      }
    },
    delete: async (d) => {
      const ask = deckDeleteConfirm(d);
      if (ask && !(await confirm(ask))) return;
      try {
        await sendAndAwaitAck(getClient(), { type: "delete_deck", deckId: d.id }, { op: "delete_deck", id: d.id });
      } catch (e) {
        failed(e);
        return;
      }
      toast({
        message: "Deck deleted",
        action: {
          label: "Undo",
          onClick: () => {
            sendAndAwaitAck(getClient(), { type: "restore_deck", deckId: d.id }, { op: "restore_deck", id: d.id }).catch(
              failed,
            );
          },
        },
      });
    },
  };

  const createDeck = async (deck: Deck) => {
    try {
      await sendAndAwaitAck(getClient(), { type: "save_deck", deck }, { op: "save_deck", id: deck.id });
    } catch (e) {
      failed(e);
      return;
    }
    setNewOpen(false);
    router.push(editHref(deck.id));
  };

  const offline = !connected;
  return (
    <PageBody variant="list">
      <PageChrome title="Slides" />
      <LibraryList<DeckMeta>
        key={tagKey}
        items={decks}
        getId={(d) => d.id}
        primary={(d) => d.name}
        secondary={(d) => (d.usedBy > 0 ? `Used in ${plural(d.usedBy, "show")}` : "")}
        kind={() => "slides"}
        columns={deckColumns}
        searchText={searchText}
        sorts={deckSorts}
        defaultSort={DEFAULT_DECK_SORT}
        filters={filters}
        menuItems={(d) => deckMenuItems(d, actions)}
        onOpen={actions.open}
        primaryAction={{
          label: "New deck",
          onClick: () => setNewOpen(true),
          disabledReason: offline ? "Reconnect to create" : undefined,
        }}
        storageKey={DECK_LIST_STORAGE_KEY}
        emptyState={{
          title: "No decks yet",
          body: "Decks are reusable slides for liturgy, responses, anthems and announcements.",
          action: offline ? undefined : { label: "New deck", onClick: () => setNewOpen(true) },
        }}
        loading={connected && !listed && decks.length === 0}
        // Offline with nothing loaded: say so. With decks already loaded, keep showing them.
        error={offline && decks.length === 0 ? offlineCopy("decks").title : null}
      />
      <NewDeckDialog open={newOpen} onClose={() => setNewOpen(false)} onCreate={createDeck} />
    </PageBody>
  );
}

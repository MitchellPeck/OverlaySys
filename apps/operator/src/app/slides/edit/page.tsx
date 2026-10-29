"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DeckEditor } from "./DeckEditor";

// useSearchParams suspends during static prerender; the Suspense boundary lets
// the static export complete (the page hydrates with the real query string).
export default function DeckEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <DeckEditorPageInner />
    </Suspense>
  );
}

function DeckEditorPageInner() {
  const params = useSearchParams();
  const id = params?.get("id") ?? "";
  return <DeckEditor deckId={id} />;
}

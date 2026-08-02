import {
  PcoArrangementSchema,
  PcoPlanItemSchema,
  PcoPlanSchema,
  PcoServiceTypeSchema,
  PcoSongSchema,
  pickLyricsArrangement,
  type PcoArrangement,
  type PcoItemType,
  type PcoPlan,
  type PcoPlanItem,
  type PcoServiceType,
} from "@overlaysys/core";

const BASE = "https://api.planningcenteronline.com/services/v2";

export class PcoAuthError extends Error {
  constructor(message = "Planning Center session expired — please reconnect.") {
    super(message);
    this.name = "PcoAuthError";
  }
}

export interface PcoClient {
  listServiceTypes(): Promise<PcoServiceType[]>;
  listPlans(serviceTypeId: string): Promise<PcoPlan[]>;
  getPlanItems(serviceTypeId: string, planId: string): Promise<PcoPlanItem[]>;
  listSongArrangements(songId: string): Promise<PcoArrangement[]>;
}

interface JsonApiResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | null }>;
}
interface JsonApiDoc {
  data?: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  links?: { next?: string | null };
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.trim() === "" ? undefined : v;
  return String(v);
}

const ITEM_TYPES: PcoItemType[] = ["song", "header", "media", "item"];
function coerceItemType(v: unknown): PcoItemType {
  return ITEM_TYPES.includes(v as PcoItemType) ? (v as PcoItemType) : "item";
}

/** Shared JSON:API → PcoArrangement mapping, used for both the plan item's
 * own arrangement (`getPlanItems`) and a song's sibling arrangements
 * (`listSongArrangements`). */
function parseArrangement(r: JsonApiResource) {
  const seq = r.attributes?.["sequence"];
  return PcoArrangementSchema.parse({
    id: r.id,
    name: str(r.attributes?.["name"]),
    lyrics: str(r.attributes?.["lyrics"]),
    sequence: Array.isArray(seq) ? seq.map((s) => String(s)) : undefined,
  });
}

/**
 * Create a Planning Center Services client bound to a ready-to-send
 * `Authorization` header value (`Bearer <token>` from OAuth, or
 * `Basic <base64>` from a Personal Access Token). `fetchImpl` is injectable so
 * tests (and the import route's unit tests) can stub HTTP without hitting the
 * network.
 */
export function createPcoClient(
  authorization: string,
  fetchImpl: typeof fetch = fetch,
): PcoClient {
  async function getAll(pathOrUrl: string): Promise<{
    data: JsonApiResource[];
    included: JsonApiResource[];
  }> {
    const data: JsonApiResource[] = [];
    const included: JsonApiResource[] = [];
    let url: string | null = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${BASE}${pathOrUrl}`;

    // Follow JSON:API `links.next` for offset pagination. Bounded retry on 429.
    while (url) {
      let attempt = 0;
      // eslint-disable-next-line no-await-in-loop
      let res = await fetchImpl(url, {
        headers: { Authorization: authorization, Accept: "application/json" },
      });
      while (res.status === 429 && attempt < 3) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, Math.max(1, retryAfter) * 1000));
        attempt++;
        // eslint-disable-next-line no-await-in-loop
        res = await fetchImpl(url, {
          headers: { Authorization: authorization, Accept: "application/json" },
        });
      }
      if (res.status === 401) throw new PcoAuthError();
      if (!res.ok) {
        throw new Error(`Planning Center request failed (${res.status}): ${url}`);
      }
      // eslint-disable-next-line no-await-in-loop
      const doc = (await res.json()) as JsonApiDoc;
      if (Array.isArray(doc.data)) data.push(...doc.data);
      else if (doc.data) data.push(doc.data);
      if (doc.included) included.push(...doc.included);
      url = doc.links?.next ?? null;
    }
    return { data, included };
  }

  /** All arrangements for a song, e.g. to find one carrying lyrics when the
   * plan item's own arrangement is empty. */
  async function listSongArrangements(songId: string): Promise<PcoArrangement[]> {
    const { data } = await getAll(`/songs/${songId}/arrangements?per_page=100`);
    return data.map(parseArrangement);
  }

  return {
    listSongArrangements,

    async listServiceTypes() {
      const { data } = await getAll(`/service_types?per_page=100`);
      return data.map((r) =>
        PcoServiceTypeSchema.parse({
          id: r.id,
          name: str(r.attributes?.["name"]) ?? "(untitled)",
        }),
      );
    },

    async listPlans(serviceTypeId) {
      const { data } = await getAll(
        `/service_types/${serviceTypeId}/plans?filter=future&order=sort_date&per_page=50`,
      );
      return data.map((r) =>
        PcoPlanSchema.parse({
          id: r.id,
          title: str(r.attributes?.["title"]),
          dates: str(r.attributes?.["dates"]),
          sortDate: str(r.attributes?.["sort_date"]),
        }),
      );
    },

    async getPlanItems(serviceTypeId, planId) {
      const { data, included } = await getAll(
        `/service_types/${serviceTypeId}/plans/${planId}/items?include=song,arrangement&per_page=100`,
      );
      const byKey = new Map<string, JsonApiResource>();
      for (const r of included) byKey.set(`${r.type}:${r.id}`, r);

      const items: PcoPlanItem[] = data.map((r) => {
        const a = r.attributes ?? {};
        const rel = r.relationships ?? {};

        const songRef = rel["song"]?.data;
        const songRes = songRef ? byKey.get(`${songRef.type}:${songRef.id}`) : undefined;
        const song = songRes
          ? PcoSongSchema.parse({
              id: songRes.id,
              title: str(songRes.attributes?.["title"]) ?? "(untitled)",
              author: str(songRes.attributes?.["author"]),
              ccliNumber: str(songRes.attributes?.["ccli_number"]),
              copyright: str(songRes.attributes?.["copyright"]),
            })
          : undefined;

        const arrRef = rel["arrangement"]?.data;
        const arrRes = arrRef ? byKey.get(`${arrRef.type}:${arrRef.id}`) : undefined;
        const arrangement = arrRes ? parseArrangement(arrRes) : undefined;

        const seqNum = a["sequence"];
        return PcoPlanItemSchema.parse({
          id: r.id,
          title: str(a["title"]) ?? "(untitled)",
          sequence: typeof seqNum === "number" ? seqNum : undefined,
          itemType: coerceItemType(a["item_type"]),
          description: str(a["description"]),
          htmlDetails: str(a["html_details"]),
          song,
          arrangement,
        });
      });

      // PCO returns items already ordered by sequence, but sort defensively.
      items.sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0));

      // Lyrics live on the arrangement in PCO, and a song's lyrics are often
      // filled in on only one of several arrangements. When the arrangement
      // this plan item references is empty, look at the song's others. Only
      // lyric-less song items pay for the extra request.
      return Promise.all(
        items.map(async (item) => {
          if (item.itemType !== "song" || !item.song) return item;
          const own = item.arrangement;
          if (own?.lyrics && own.lyrics.trim() !== "") return item;
          const siblings = await listSongArrangements(item.song.id);
          const pick = pickLyricsArrangement(siblings, own?.id);
          return pick ? { ...item, lyricsArrangement: pick } : item;
        }),
      );
    },
  };
}

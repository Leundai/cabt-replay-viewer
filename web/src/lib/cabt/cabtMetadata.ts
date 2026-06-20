import cardDataUrl from './cardData.generated.json?url';
import attackDataUrl from './attackData.generated.json?url';
import type { CabtReplayAttackRow, CabtReplayCardRow } from './cabtViewAdapter';

export type DeckCardMetadata = {
  id: number;
  name: string;
  set: string;
  setNumber?: string | null;
  cardType?: number | null;
};

export type CabtGeneratedMetadata = {
  cardRows: Array<CabtReplayCardRow & DeckCardMetadata>;
  attackRows: CabtReplayAttackRow[];
};

export type CabtDeckMetadata = Pick<CabtGeneratedMetadata, 'cardRows'>;

let cachedMetadata: Promise<CabtGeneratedMetadata> | null = null;
let cachedCardRows: Promise<Array<CabtReplayCardRow & DeckCardMetadata>> | null = null;
let cachedAttackRows: Promise<CabtReplayAttackRow[]> | null = null;

export function loadCabtDeckMetadata(): Promise<CabtDeckMetadata> {
  return loadCabtCardRows().then((cardRows) => ({ cardRows }));
}

export function loadCabtGeneratedMetadata(): Promise<CabtGeneratedMetadata> {
  cachedMetadata ??= Promise.all([loadCabtCardRows(), loadCabtAttackRows()])
    .then(([cardRows, attackRows]) => ({ cardRows, attackRows }));
  return cachedMetadata;
}

function loadCabtCardRows(): Promise<Array<CabtReplayCardRow & DeckCardMetadata>> {
  cachedCardRows ??= loadJson<Array<CabtReplayCardRow & DeckCardMetadata>>(cardDataUrl);
  return cachedCardRows;
}

function loadCabtAttackRows(): Promise<CabtReplayAttackRow[]> {
  cachedAttackRows ??= loadJson<CabtReplayAttackRow[]>(attackDataUrl);
  return cachedAttackRows;
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

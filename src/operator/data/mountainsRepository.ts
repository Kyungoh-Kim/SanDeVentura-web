import { type Mountain } from './readModels';
import { invokeOperatorApi } from './operatorApiClient';

type MountainRow = {
  id: string;
  display_name: string;
  bbox: string | null;
};

export async function fetchMountains(): Promise<Mountain[]> {
  const data = await invokeOperatorApi<MountainRow[]>('mountains');

  return ((data ?? []) as MountainRow[]).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    bbox: row.bbox,
  }));
}

export async function createMountain(
  id: string,
  displayName: string,
  bbox: string | null,
): Promise<void> {
  await invokeOperatorApi<null>('createMountain', { mountainId: id, displayName, bbox });
}

export async function updateMountainBbox(
  id: string,
  bbox: string | null,
): Promise<void> {
  await invokeOperatorApi<null>('updateMountainBbox', { mountainId: id, bbox });
}

export function parseBbox(
  raw: string | null,
): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (
    parts.length !== 4 ||
    parts.some(Number.isNaN) ||
    parts[0] >= parts[2] ||
    parts[1] >= parts[3]
  ) {
    return null;
  }
  return parts as [number, number, number, number];
}

export function formatBbox(
  bbox: [number, number, number, number],
): string {
  return bbox.map((n) => n.toFixed(6)).join(',');
}

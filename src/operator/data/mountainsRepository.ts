import { type Mountain } from './readModels';
import { supabase } from './supabaseClient';

type MountainRow = {
  id: string;
  display_name: string;
  bbox: string | null;
};

export async function fetchMountains(): Promise<Mountain[]> {
  if (supabase === null) {
    return [];
  }

  const { data, error } = await supabase
    .from('mountains')
    .select('id, display_name, bbox')
    .order('display_name');

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as MountainRow[]).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    bbox: row.bbox,
  }));
}

export async function updateMountainBbox(
  id: string,
  bbox: string | null,
): Promise<void> {
  if (supabase === null) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabase
    .from('mountains')
    .update({ bbox })
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }
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

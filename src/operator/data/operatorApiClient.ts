import { supabase } from './supabaseClient';

type OperatorApiResponse<T> =
  | { success: true; data: T }
  | { success: false; errors?: string[] };

export async function invokeOperatorApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (supabase === null) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.functions.invoke<OperatorApiResponse<T>>(
    'operator-api',
    { method: 'POST', body: { action, ...payload } },
  );

  if (error) {
    throw new Error(error.message ?? 'Operator API invocation failed');
  }
  if (!data?.success) {
    const serverErr = data?.errors?.[0] ?? 'Operator API returned an error';
    // map a few well-known server error codes to user-friendly messages
    if (serverErr === 'mountain_id_conflict') throw new Error('Mountain id already exists');
    if (typeof serverErr === 'string' && serverErr.startsWith('invalid_bbox')) throw new Error('Invalid bbox');
    throw new Error(serverErr);
  }

  return data.data;
}

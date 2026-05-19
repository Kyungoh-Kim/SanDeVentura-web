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
    throw new Error(data?.errors?.[0] ?? 'Operator API returned an error');
  }

  return data.data;
}

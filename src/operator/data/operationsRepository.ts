import { supabase } from './supabaseClient';

export type MatchAndAggregateResult = {
  processedSessions: number;
  affectedRoutes: number;
  orphanCellsAdded: number;
  candidateClustersFormed: number;
};

export async function triggerMatchAndAggregate(): Promise<MatchAndAggregateResult> {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.functions.invoke(
    'match-and-aggregate-sessions',
    { method: 'POST', body: {} },
  );

  if (error) {
    throw new Error(error.message ?? 'Edge function invocation failed');
  }

  if (!data?.success) {
    const msg = data?.errors?.[0] ?? 'Unknown error from edge function';
    throw new Error(msg);
  }

  return {
    processedSessions: data.processedSessions ?? 0,
    affectedRoutes: data.affectedRoutes ?? 0,
    orphanCellsAdded: data.orphanCellsAdded ?? 0,
    candidateClustersFormed: data.candidateClustersFormed ?? 0,
  };
}

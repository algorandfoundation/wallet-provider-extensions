import { useEffect, useState } from "react";
import { useProvider } from "@/hooks/useProvider";

/** The state of the application's one-time migration run. */
export interface MigrationsState {
  /** True until the run settles. */
  pending: boolean;
  /** Set when the run failed; the app should not read migrated data. */
  error: Error | null;
}

/**
 * Awaits the provider's migration run.
 *
 * Gate anything that reads persisted data on `pending` being false, and surface
 * `error` rather than swallowing it — a failed migration means the data on disk
 * is not in the shape this build expects.
 *
 * @returns The current {@link MigrationsState}.
 *
 * @example
 * ```tsx
 * const { pending, error } = useMigrations();
 * if (pending) return <ActivityIndicator />;
 * if (error) return <Text>Migration failed: {error.message}</Text>;
 * ```
 */
export function useMigrations(): MigrationsState {
  const provider = useProvider();
  const [state, setState] = useState<MigrationsState>({ pending: true, error: null });

  useEffect(() => {
    let active = true;
    provider.migrations.ready.then(
      () => {
        if (active) setState({ pending: false, error: null });
      },
      (error: Error) => {
        if (active) setState({ pending: false, error });
      },
    );
    return () => {
      active = false;
    };
  }, [provider]);

  return state;
}

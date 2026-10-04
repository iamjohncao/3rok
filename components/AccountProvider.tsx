"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { accountStateFor, type AccountState } from "../lib/account";
import { createClient } from "../lib/supabase/client";
import { accountsConfigured } from "../lib/supabase/env";

const AccountContext = createContext<AccountState>({ status: "loading" });

/** Who is signed in. For what the page shows. The server checks the session itself on every request. */
export function useAccount(): AccountState {
  return useContext(AccountContext);
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>(
    accountsConfigured() ? { status: "loading" } : { status: "unavailable" },
  );

  useEffect(() => {
    if (!accountsConfigured()) return;
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      setState(accountStateFor(session?.user ?? null));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>;
}

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_BRANDING, setBranding, type Branding } from "@/lib/settings";

interface SettingsContextValue {
  settings: Branding;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Branding | null;
    },
    staleTime: 60_000,
  });

  const settings: Branding = { ...DEFAULT_BRANDING, ...(data ?? {}) };

  useEffect(() => {
    if (data) setBranding(data);
    // browser tab title reflects business name
    if (typeof document !== "undefined") {
      document.title = `${settings.business_name} — ${settings.business_tagline}`;
    }
  }, [data]);

  return (
    <SettingsContext.Provider value={{ settings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) return { settings: DEFAULT_BRANDING, isLoading: false };
  return ctx;
}

import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { bootstrapDesktopReferenceData } from "@/lib/desktop-bootstrap";
import { syncPendingPosSales } from "@/lib/desktop-pos";
import { DesktopSyncStatus } from "@/components/app/DesktopSyncStatus";
import { syncPendingPurchases } from "@/lib/desktop-purchases";
import { syncPendingNormalSales } from "@/lib/desktop-sales";
import { syncPendingPayments } from "@/lib/desktop-payments";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

const ADMIN_ONLY = ["/dashboard", "/reports", "/settings", "/payments", "/expenses", "/employees", "/vault", "/activity", "/sync"];

function AuthenticatedLayout() {
  const { session, loading, role, isAdmin } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const blocked = !isAdmin && ADMIN_ONLY.some((p) => pathname === p || pathname.startsWith(p + "/"));

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!loading && session && role && blocked) navigate({ to: "/stock", replace: true });
  }, [loading, session, role, blocked, navigate]);

  useEffect(() => {
    if (loading || !session || !window.fhDesktop?.isDesktop) return;
    // Initial/reference refresh is best-effort. A network failure must never block the desktop UI.
    Promise.all([syncPendingPosSales(), syncPendingPurchases(), syncPendingNormalSales(), syncPendingPayments()]).then(() => bootstrapDesktopReferenceData()).catch((error) => console.warn("[Desktop] Sync/bootstrap deferred:", error));
  }, [loading, session]);

  useEffect(() => {
    if (loading || !session || !window.fhDesktop?.isDesktop) return;
    const sync = () => void Promise.all([syncPendingPosSales(), syncPendingPurchases(), syncPendingNormalSales(), syncPendingPayments()]).then(() => bootstrapDesktopReferenceData()).catch((error) => console.warn("[Desktop] Reconnect sync deferred:", error));
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [loading, session]);

  if (loading || !session || blocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <DesktopSyncStatus />
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, MonitorDown, ShieldCheck, WifiOff, ExternalLink, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/desktop-download")({ component: DesktopDownloadPage });

const releasesApi = "https://api.github.com/repos/zubid/fhtraders/releases/tags/desktop-latest";
const releasesPage = "https://github.com/zubid/fhtraders/releases/tag/desktop-latest";

type Release = {
  name: string; published_at: string; html_url: string;
  assets: { name: string; browser_download_url: string; size: number }[];
};

function DesktopDownloadPage() {
  const release = useQuery({
    queryKey: ["desktop-release"],
    queryFn: async (): Promise<Release | null> => {
      const response = await fetch(releasesApi, { headers: { Accept: "application/vnd.github+json" } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Unable to check the desktop release. Try again shortly.");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const installer = release.data?.assets?.find((a) => /\.exe$/i.test(a.name) && /setup|install/i.test(a.name))
    ?? release.data?.assets?.find((a) => /\.exe$/i.test(a.name));
  return <div className="mx-auto max-w-4xl space-y-6">
    <PageHeader title="Desktop App" description="Install FH Traders on your Windows computer." />
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary/10 via-background to-background px-6 py-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary"><MonitorDown className="h-8 w-8" /></div>
          <div><h2 className="text-2xl font-semibold tracking-tight">FH Traders for Windows</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your POS, ready for the desktop.</p></div>
          <Badge variant="secondary" className="ml-auto">Windows</Badge>
        </div>
        <p className="mt-5 max-w-xl text-sm text-muted-foreground">
          Install the desktop app for local POS workflows. Offline transactions require synchronization before daily closing; verify the Sync Center before relying on offline operation.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {installer ? <Button size="lg" asChild>
            <a href={installer.browser_download_url} rel="noopener noreferrer">
              <Download className="mr-2 h-5 w-5" /> Download for Windows
            </a>
          </Button> : <Button size="lg" disabled><Download className="mr-2 h-5 w-5" /> {release.isLoading ? "Checking installer..." : "Installer unavailable"}</Button>}
          <Button variant="outline" asChild><a href={release.data?.html_url ?? releasesPage} target="_blank" rel="noopener noreferrer">
            Release details <ExternalLink className="ml-2 h-4 w-4" />
          </a></Button>
        </div>
        {installer && <p className="mt-3 text-xs text-muted-foreground">{installer.name} · {(installer.size / 1024 / 1024).toFixed(1)} MB
          {release.data?.published_at ? ` · Updated ${new Date(release.data.published_at).toLocaleDateString("en-PK")}` : ""}
        </p>}
        {!installer && !release.isLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">
          {release.isError ? (release.error as Error).message : "A downloadable Windows installer has not been published yet. Please check back after the next successful desktop build."}
          <Button size="sm" variant="ghost" className="ml-2" onClick={() => release.refetch()}><RefreshCw className="mr-1 h-3 w-3" />Retry</Button>
        </p>}
      </div>
    </Card>
    <div className="grid gap-4 sm:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><WifiOff className="h-5 w-5" /> Offline-ready POS</CardTitle>
        <CardDescription>Work locally where supported, then sync queued operations when online. Never assume a transaction has synced until confirmed.</CardDescription></CardHeader></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5" /> Secure sign-in</CardTitle>
        <CardDescription>Use your existing FH Traders account. Installation does not grant access without valid login credentials.</CardDescription></CardHeader></Card>
    </div>
    <Card><CardHeader><CardTitle className="text-base">How to install</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>1. Download the Windows setup file above.</p>
        <p>2. Run the installer and follow the setup steps. Windows may ask you to confirm an unsigned installer.</p>
        <p>3. Launch FH Traders and sign in using your existing account.</p>
        <p>4. Confirm synchronization and printer settings before using it for real transactions.</p>
      </CardContent></Card>
  </div>;
}

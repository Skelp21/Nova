import { useEffect } from "react";
import { ContextMenu } from "./components/ContextMenu";
import { Modals } from "./components/Modals";
import { PlayerBar } from "./components/PlayerBar";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { HomePage } from "./pages/Home";
import { DownloadsPage, HistoryPage, LibraryHub, LikedPage, PlaylistPage, PlaylistsPage } from "./pages/LibraryPages";
import { MiniBar, MobileHeader, MobileNav, NowPlaying } from "./components/Mobile";
import { isMobile } from "./lib/platform";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { usePlayer } from "./store/player";
import { applyTheme, useSettings } from "./store/settings";
import { useUi } from "./store/ui";

function Page() {
  const route = useUi((s) => s.route);
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage query={route.query} />;
    case "liked":
      return <LikedPage />;
    case "history":
      return <HistoryPage />;
    case "downloads":
      return <DownloadsPage />;
    case "playlists":
      return <PlaylistsPage />;
    case "playlist":
      return <PlaylistPage id={route.id} />;
    case "settings":
      return <SettingsPage tab={route.tab} />;
    case "library":
      return <LibraryHub />;
  }
}

function Backdrop() {
  const cover = usePlayer((s) => s.queue[s.index]?.cover);
  const enabled = useSettings((s) => s.coverBackdrop);
  if (!enabled || !cover) return null;
  return <div className="backdrop" style={{ backgroundImage: `url("${cover}")` }} />;
}

export function App() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const route = useUi((s) => s.route);

  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  useEffect(() => {
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, [route]);

  if (isMobile)
    return (
      <div className="app m-app">
        <Backdrop />
        <MobileHeader />
        <main className="content">
          <Page />
        </main>
        <MiniBar />
        <MobileNav />
        <NowPlaying />
        <ContextMenu />
        <Modals />
        <Toasts />
      </div>
    );

  return (
    <div className="app" onContextMenu={(e) => !(e.target as HTMLElement).closest("input, textarea") && e.preventDefault()}>
      <Backdrop />
      <Sidebar />
      <div className="main">
        <TitleBar />
        <div className="main-row">
          <main className="content">
            <Page />
          </main>
          <RightPanel />
        </div>
      </div>
      <PlayerBar />
      <ContextMenu />
      <Modals />
      <Toasts />
    </div>
  );
}
